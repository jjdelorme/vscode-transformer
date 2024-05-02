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

// Define an interface for the TransformRequest
interface TransformRequest {
  sourceUrl: string;
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

      if (request.sourceUrl === '') {
        fileContents = `<code>\n${this.getOpenTab()}\n</code>`;
      } else {
        fileContents = await this.getFileContents(request.sourceUrl);
      }

      const enrichedPrompt = `${request.prompt}\n\n<context>\n${fileContents}\n</context>`;

      const result = await this.generateText(enrichedPrompt);

      return result;
    }
    catch (error) {
      console.error(error);
      throw error;
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

    // const clientOptions = {
    //   apiEndpoint: `${this.options.locationId}-aiplatform.googleapis.com`,
    // };
    // const {PredictionServiceClient, protos} = await import('@google-cloud/aiplatform');
    // const predictionServiceClient = new PredictionServiceClient(clientOptions);

    const [response] = await this.predictionServiceClient.generateContent(request);
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
