import * as vscode from 'vscode';
import * as path from 'path';
import {VertexAI} from "@google-cloud/vertexai";

// Define an interface for the TransformerOptions
interface TransformerOptions {
  projectId: string;
  locationId: string;
  modelId: string;
}

export enum SourceType {
	OpenTab,
	Repository,
}

// Define an interface for the TransformRequest
export interface TransformRequest {
  sourceType: SourceType;
  prompt: string;
  model: string;
}

// Define the Transformer class
export class Transformer {
  private readonly options: TransformerOptions;
  private readonly model: string;
  private readonly vertex: VertexAI;

  constructor(options: TransformerOptions) {
    this.options = options;

    if (!this.options.projectId) {
      throw new Error("Missing configuration variable: projectId");
    }

    this.model = `projects/${this.options.projectId}/locations/${this.options.locationId}/publishers/google/models/${this.options.modelId}`;

    const clientOptions = {
      apiEndpoint: `${this.options.locationId}-aiplatform.googleapis.com`,
      
    };

    this.vertex = new VertexAI({
      project: this.options.projectId,
      location: this.options.locationId,
    });
  }

  // Function to execute a code transformation
  public async generate(request: TransformRequest): Promise<string|undefined> {
    let fileContents = '';

    let instructions = "<instructions>\n" +
      "- Thoroughly read the code provided in each file in the context\n";

    if (request.sourceType === SourceType.OpenTab) {
      fileContents = this.getOpenTab();
    } else {
      instructions += 
        "- Understand the dependencies between each file, developing a dependency tree in your mind\n" +
        "- Establish a deep understanding of what the code does and any external dependencies not provided in the context\n" +
        "- Use all of the files to understand this specific environment and its dependencies\n" +
        "- When responding to the user request, be thorough and return the complete files when asked to migrate even if all the lines have not changed\n" +
        "- When responding in the context of a file return the filename as a clickable hyperlink to the filename in markdown syntax for example [filename.cs](../directory/filename.cs) \n "
      
      fileContents = await this.getFileContents('**/*.cs*');
    }

    instructions += "</instructions>\n";

    const enrichedPrompt = `"<context>\n${fileContents}\n</context>\n\n${instructions}\nUser request: ${request.prompt}"`;

    const result = await this.generateText(enrichedPrompt);

    return result;
  }

  /** Cancel client requests. */
  public async cancel(): Promise<void> {
    // return this.vertex.
  }

  // Function to invoke the Vertex AI Model to generate text
  private async generateText(textPrompt: string): Promise<string> {
    const generativeModel = this.vertex.preview.getGenerativeModel({
      model: this.options.modelId,
      generationConfig: {
        'maxOutputTokens': 8192,
        'temperature': 0.2,
        'topP': 0.95,
      },
      systemInstruction: {
        role: 'system',
        parts: [{"text": `You are a helpful expert .NET developer with extensive experience in migrating applications from .NET Framework to the latest versions of .NET.`}]
      },
    }, { timeout: 120000 });

    const req = {
      contents: [
        {role: 'user', parts: [{text: textPrompt}]}
      ],
    };

    const result = await generativeModel.generateContent(req);

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

  private getOpenTab(): string {
    return this.formatFileContents(vscode.window.activeTextEditor?.document);
  }

  private async getFileContents(globPattern: string): Promise<string> {
    const files = await vscode.workspace.findFiles(globPattern);
    var text = '<files>\n';
    for (const uri of files) {
      const document = await vscode.workspace.openTextDocument(uri);
      text += this.formatFileContents(document);
    }

    return text + '/n</files>';
  }

  private formatFileContents(document: vscode.TextDocument | undefined): string {
    if (!document)
      throw new Error("Document is undefined");
    const fileName = path.relative(vscode.workspace.workspaceFolders![0].uri.path, document.uri.path);
    const code = document.getText();
    
    return `<code filename='../${fileName}'>${code}</code>`;
  }
}
