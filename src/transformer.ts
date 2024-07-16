import * as vscode from 'vscode';
import * as path from 'path';
import {GenerateContentRequest, GenerationConfig, ModelParams, VertexAI} from "@google-cloud/vertexai";

// Define an interface for the TransformerOptions
export interface TransformerOptions {
  googleAdc?: string;
  projectId: string;
  locationId: string;
  systemPrompt: string;
  temperature: number;
  // Array of file types to include
  include?: string[];
  topP?: number;
}

export enum SourceType {
	OpenTab,
	Repository,
}

// Define an interface for the TransformRequest
export interface TransformRequest {
  sourceType: SourceType;
  prompt: string;
  modelId: string;
  useContextCache: boolean;
}

// SDK doesn't support this yet (https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-use)
interface ExtendedGenerateContentRequest extends GenerateContentRequest {
  cached_content?: string;
}

// Define the Transformer class
export class Transformer {
  private readonly options: TransformerOptions;
  private readonly vertex: VertexAI;
  private readonly output: vscode.OutputChannel;
  private readonly generationConfig: GenerationConfig;

  private contextCacheId?: string;


  constructor(options: TransformerOptions, output: vscode.OutputChannel) {
    this.options = options;
    this.output = output;

    if (!this.options.projectId) {
      throw new Error("Missing configuration variable: projectId");
    }

    this.vertex = new VertexAI({
      project: this.options.projectId,
      location: this.options.locationId,
    });

    this.generationConfig = {
      'maxOutputTokens': 8192,
      'temperature': this.options.temperature,
      'topP': this.options.topP,
      // 'response_mime_type': 'application/json',
    };

    if (this.options.googleAdc) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = this.options.googleAdc;
    }

    this.output.appendLine('Transformer initialized');
  }

  /** Generate a string response (likely containing markdown) from the Gemini model based on
   *  either an open tab or the entire repository.
   */
  public async generate(request: TransformRequest): Promise<string|undefined> {
    let context: string | undefined;
    
    if ( request.sourceType === SourceType.OpenTab || 
        // Using repo with cache for the first time
        (request.sourceType === SourceType.Repository && request.useContextCache && !this.contextCacheId) ) {
      context = await this.getContext(request.sourceType);
    }

    // Create the cache
    if (request.sourceType === SourceType.Repository && request.useContextCache && context) {
      const cacheRequest: GenerateContentRequest = {
        contents: [
          {
            role: 'system',
            parts: [{"text": this.options.systemPrompt}]            
          },
          {role: 'user', parts: [{text: context}]}
        ],
      };

      this.contextCacheId = await this.createCache(cacheRequest, request.modelId);

      this.output.append(`Created context cache id: ${this.contextCacheId}`);
    }

    let modelParams: ModelParams = { 
      model: request.modelId,
      generationConfig: this.generationConfig
    };

    let generateContentRequest: ExtendedGenerateContentRequest;

    // Include system instruction only if we're using repository and not using the context cache
    if (request.sourceType === SourceType.Repository && 
        (!request.useContextCache || !this.contextCacheId )) {
      modelParams = { 
        ...modelParams, 
        systemInstruction: {
          role: 'system',
          parts: [{"text": this.options.systemPrompt}]
        }
      }
    }

    if (request.sourceType === SourceType.Repository && this.contextCacheId) {
      // Build the cached request
      this.output.appendLine(`Using cache id: ${this.contextCacheId}`);

      generateContentRequest = {
        cached_content: this.contextCacheId,
        contents: [
          {role: 'user', parts: [{text: request.prompt}]}
        ],
      };
    } 
    else {
      // normal request
      const prompt = `${context}\nUser request: ${request.prompt}`;

      generateContentRequest = {
        contents: [
          {role: 'user', parts: [{text: prompt}]}
        ],
      };

      this.output.append('Complete Prompt:\n' + prompt);
    }

    const result = await this.invokeModel(modelParams, generateContentRequest!);

    return result;
  }

  /** Cancel client requests. */
  public async cancel(): Promise<void> {
    this.output.appendLine('Canceling...');
    // return this.vertex.
  }

  private async getContext(sourceType: SourceType): Promise<string> {
    let fileContents = '<context>\n';

    if (sourceType === SourceType.OpenTab) {
      fileContents += this.getOpenTab();
    } else {     
      fileContents += await this.getFileContents();
    }

    fileContents += '\n</context>\n\n';

    return fileContents;
  }

  private getOpenTab(): string {
    return this.formatFileContents(vscode.window.activeTextEditor?.document);
  }

  private async getFileContents(): Promise<string> {
    const files = await this.getFiles();
    
    var text = '<files>\n';
    for (const uri of files) {
      const document = await vscode.workspace.openTextDocument(uri);
      text += this.formatFileContents(document);
    }
    text += '/n</files>';
    
    return text;
  }

  private async getFiles(): Promise<vscode.Uri[]> {
    let files: vscode.Uri[] = [];

    if (!this.options.include) throw new Error("Missing configuration variable: include");

    for (let i = 0; i < this.options.include.length; i++) {
      this.output.appendLine("Using the following files...");
      const pattern = this.options.include[i];
      const matches = await vscode.workspace.findFiles(pattern);
      if (matches) {
        files = files.concat(matches);
        matches.forEach(m => this.output.appendLine(m.path));
      }
    };

    return files;
  }


  private formatFileContents(document: vscode.TextDocument | undefined): string {
    if (!document)
      throw new Error("Document is undefined");
    const fileName = path.relative(vscode.workspace.workspaceFolders![0].uri.path, document.uri.path);
    const code = document.getText();
    
    return `<code filename='../${fileName}'>${code}</code>`;
  }

  /** Wraps invocation of the VertexAI and handling response */
  private async invokeModel(modelParams: ModelParams, generateContentRequest: GenerateContentRequest): Promise<string> {
    const generativeModel = this.vertex.getGenerativeModel(modelParams, { timeout: 120000 });

    var result;
    
    try {
      result = await generativeModel.generateContent(generateContentRequest);
    }
    catch (error: any) {
      this.output.appendLine('[ERROR] An error occurred while generating the response');
      this.output.appendLine(error);
      throw new Error(error.message);
    }

    if (!result.response)
      throw new Error("No response from Vertex AI")
    
    const response = result.response;
    
    vscode.window.showInformationMessage(`Used ${response.usageMetadata?.totalTokenCount} tokens`);

    if (response.candidates![0].finishReason != 'STOP') {
      vscode.window.showErrorMessage("Finished with reason: " + response.candidates![0].finishReason);

      const message = response.candidates ? response.candidates[0].finishMessage : 'No details provided';
      throw new Error(message);
    }

    const text = response.candidates![0].content?.parts![0].text ?? '';
    return text;
  }
  
  /** Creates a context cache and returns the identifier */
  private async createCache(generateContentRequest: GenerateContentRequest, modelId: string): Promise<string|undefined> {
    this.output.appendLine("Dummy call to create cache");

    /* Sample request (https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-create)
    {
      "model": "projects/PROJECT_ID/locations/LOCATION/publishers/google/models/gemini-1.5-pro-001",
      "contents": [{
        "role": "user",
          "parts": [{
            "fileData": {
              "mimeType": "MIME_TYPE",
              "fileUri": "CONTENT_TO_CACHE_URI"
            }
          }]
      },
      {
        "role": "model",
          "parts": [{
            "text": "This is sample text to demonstrate explicit caching."
          }]
      }]
    }
    */

    const request = { 
      ...generateContentRequest,
      'model': `projects/${this.options.projectId}/locations/${this.options.locationId}/publishers/google/models/${modelId}`,
    }


    /* Expected sample response:
    {
      "name": "projects/PROJECT_NUMBER/locations/us-central1/cachedContents/CACHE_ID",
      "model": "projects/PROJECT_ID/locations/us-central1/publishers/google/models/gemini-1.5-pro-001",
      "createTime": "2024-06-04T01:11:50.808236Z",
      "updateTime": "2024-06-04T01:11:50.808236Z",
      "expireTime": "2024-06-04T02:11:50.794542Z"
    }
    */

    //return "projects/PROJECT_NUMBER/locations/us-central1/cachedContents/CACHE_ID";
    return undefined;
  }
}
