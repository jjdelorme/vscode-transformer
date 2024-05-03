import * as vscode from 'vscode';
import { PredictionServiceClient, protos } from "@google-cloud/aiplatform";

const SYSTEM_PROMPT = {
  role: "SYSTEM",
  parts: [{ text: 'You are an expert .NET developer with extensive experience in migrating applications from .NET Framework to the latest versions of .NET.' }],
};

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
}

// Define the Transformer class
export class Transformer {
  private readonly options: TransformerOptions;
  private readonly model: string;
  private readonly predictionServiceClient: PredictionServiceClient;

  constructor(options: TransformerOptions) {
    this.options = options;

    if (!this.options.projectId) {
      throw new Error("Missing configuration variable: projectId");
    }

    this.model = `projects/${this.options.projectId}/locations/${this.options.locationId}/publishers/google/models/${this.options.modelId}`;

    const clientOptions = {
      apiEndpoint: `${this.options.locationId}-aiplatform.googleapis.com`,
      
    };

    this.predictionServiceClient = new PredictionServiceClient(clientOptions);
  }

  // Function to execute a code transformation
  public async generate(request: TransformRequest): Promise<string> {
    try {
      let fileContents = '';

      if (request.sourceType === SourceType.OpenTab) {
        fileContents = `<code>\n${this.getOpenTab()}\n</code>`;
      } else {
        fileContents = await this.getFileContents('**/*.cs*');
      }

      const instructions = "<instructions>\n" +
      "- Thoroughly read the code provided in each file in the context\n" +
      "- Understand the dependencies between each file, developing a dependency tree in your mind\n" +
      "- Establish a deep understanding of what the code does and any external dependencies not provided in the context\n" +
      "- Use all of the files to understand this specific environment and its dependencies\n" +
      "- When responding to the user request, be thorough and return the complete files when asked to migrate even if all the lines have not changed\n" +
      "</instructions>\n";

      const enrichedPrompt = `"<context>\n${fileContents}\n</context>\n\n${instructions}\nUser request: ${request.prompt}"`;

      const result = await this.generateText(enrichedPrompt);

      return result;
    }
    catch (error) {
	    vscode.window.showErrorMessage("Error: " + error);
      return '';
    }
  }

  // Function to invoke the Vertex AI Model to generate text
  private async generateText(textPrompt: string): Promise<string> {
    const generationConfig = {
      candidateCount: 1,
      maxOutputTokens: 8192,
      temperature: 0.2,
      topP: 1,
    };

    const userContent = {
      role: "USER",
      parts: [{ text: textPrompt }],
    };

    const request = {
      systemInstruction: SYSTEM_PROMPT,
      contents: [userContent],
      generationConfig,
      model: this.model,
    };

    const callOptions = {
      // Vertex tends to take at least 30 seconds on repo level requests
      timeout: 60000,
    };

    const [response] = await this.predictionServiceClient.generateContent(request, callOptions);
    const text = response.candidates![0].content?.parts![0].text ?? '';

    return text;
  }

  private getOpenTab(): string {
    return vscode.window.activeTextEditor?.document.getText() ?? '';
  }

  private async getFileContents(globPattern: string): Promise<string> {
    const files = await vscode.workspace.findFiles(globPattern);
    var text = "";
    for (const uri of files) {
      const document = await vscode.workspace.openTextDocument(uri);
      text += `<filename>${document.fileName}</filename>\n<code>${document.getText()}</code>\n`;
    }

    return text;
  }
}
