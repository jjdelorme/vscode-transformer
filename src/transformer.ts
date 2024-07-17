import * as vscode from 'vscode';
import * as path from 'path';
import {GenerateContentRequest, GenerationConfig, HarmBlockThreshold, HarmCategory, ModelParams, SafetySetting, VertexAI} from "@google-cloud/vertexai";
import { GoogleAuth } from 'google-auth-library';
import axios from 'axios';

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
  debugEnabled?: boolean;
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
  private readonly safetySettings: SafetySetting[];

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

    this.safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE
      },
      {
        category: HarmCategory.HARM_CATEGORY_UNSPECIFIED,
        threshold: HarmBlockThreshold.BLOCK_NONE
      }
    ];

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
        // Use repo without cache  
        (request.sourceType === SourceType.Repository && !request.useContextCache) ||
        // Using repo with cache for the first time
        (request.sourceType === SourceType.Repository && request.useContextCache && !this.contextCacheId) ) {
      context = await this.getContext(request.sourceType);
    }

    // Create the cache
    if (request.sourceType === SourceType.Repository && request.useContextCache && context) {
      this.contextCacheId = await this.createCache(context, request.modelId);

      this.output.append(`Created context cache id: ${this.contextCacheId}`);
    }
   
    if (request.sourceType === SourceType.Repository && this.contextCacheId) {
      // Build the cached request
      this.output.appendLine(`Using cache id: ${this.contextCacheId}`);

      const generateContentRequest = {
        cached_content: this.contextCacheId,
        generationConfig: this.generationConfig,
        contents: [
          {role: 'user', parts: [{text: request.prompt}]}
        ],
      };

      // use cached model
      return await this.useCachedModel(generateContentRequest, request.modelId);
    } 
    else {
      // normal request
      const prompt = `${context}\nUser request: ${request.prompt}`;

      const generateContentRequest = {
        systemInstruction: {
          role: 'system',
          parts: [{"text": this.options.systemPrompt}]
        },
        contents: [
          {role: 'user', parts: [{text: prompt}]}
        ],        
      };

      const modelParams: ModelParams = { 
        model: request.modelId,
        generationConfig: this.generationConfig,
        safetySettings: this.safetySettings,
      };

      this.output.append('Complete Prompt:\n' + prompt);

      return await this.invokeModel(modelParams, generateContentRequest);
    }
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

    if (this.options.debugEnabled) {
      const filename = vscode.workspace.workspaceFolders![0].uri.fsPath + '/output.json';
      const uri = vscode.Uri.file(filename);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(generateContentRequest)));
    }

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
  private async createCache(context: string, modelId: string): Promise<string|undefined> {
    // schema here:
    // https://cloud.google.com/vertex-ai/docs/reference/rest/v1beta1/projects.locations.cachedContents
    const cacheRequest = {
      model: `projects/${this.options.projectId}/locations/${this.options.locationId}/publishers/google/models/${modelId}`,
      systemInstruction: {
        role: 'system',
        parts: [{"text": this.options.systemPrompt}]            
      },
      contents: [
        {role: 'user', parts: [{text: context}]}
      ],
      ttl: '3600s' // TODO: make this config driven
    };
    
    try {
      // Get the access token
      const token = await this.getToken();

      const config = {
        method: 'post',
        url: `https://${this.options.locationId}-aiplatform.googleapis.com/v1beta1/projects/${this.options.projectId}/locations/${this.options.locationId}/cachedContents`,
        headers: {
          'Authorization': `Bearer ${token.token}`,
          'Content-Type': 'application/json'
        },
        data: cacheRequest
      };

      // write the request to a file for debugging:
      if (this.options.debugEnabled) {
        const filename = vscode.workspace.workspaceFolders![0].uri.fsPath + '/cache.json';
        const uri = vscode.Uri.file(filename);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(config)));
      }

      // Make the API request
      const response = await axios(config);

      console.log('Context cache created:', response.data);
      
      // TODO: we need to restrict the model once you've cached
      return response.data?.name;

    } catch (error: any) {
      this.output.appendLine('[ERROR] An error occurred while creating the cache');
      this.output.appendLine(error);
      throw new Error(error.message);
    }   
  }

  /** Since this isn't provided by the SDK yet, make a direct HTTP call. */
  private async useCachedModel(request: ExtendedGenerateContentRequest, modelId: string): Promise<string|undefined> {
    try {
      // Get the access token
      const token = await this.getToken();

      const config = {
        method: 'post',
        url: `https://${this.options.locationId}-aiplatform.googleapis.com/v1beta1/projects/${this.options.projectId}/locations/${this.options.locationId}/publishers/google/models/${modelId}:generateContent`,
        headers: {
          'Authorization': `Bearer ${token.token}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        data: request,
      };

      // Make the API request
      const response = await axios(config);
      
      if (!response.data)
        throw new Error("No response from Vertex AI")

      const text = response.data.candidates![0].content?.parts![0].text ?? '';
      
      return text;
    } catch (error: any) {
      this.output.appendLine('[ERROR] An error occurred while generating the response from cache');
      this.output.appendLine(error);
      throw new Error(error.message);
    }
  }

  /** Wrap getting an authorization token for HTTP requests */
  private async getToken() {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

    // Get the client
    const client = await auth.getClient();

    // Get the access token
    const token = await client.getAccessToken();
    
    return token;
  }
}
