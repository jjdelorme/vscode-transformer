import * as vscode from 'vscode';
import { Transformer, SourceType, TransformRequest } from './transformer';

export function activate(context: vscode.ExtensionContext) {

	const provider = new PromptViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PromptViewProvider.viewType, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand('codeTransformer.clearPrompt', () => {
			provider.clearPrompt();
		}));
}

class PromptViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'codeTransformer.promptView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public clearPrompt(): void {
		if (this._view) {
			this._view.webview.postMessage({ type: 'clearPrompt' });
		}
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'generateText':
					{
						const request: TransformRequest = {
							// Force strongly typed reponse
							sourceType: data.value.sourceType === 'Repository' ? 
								SourceType.Repository : SourceType.OpenTab,
							prompt: data.value.prompt
						};

						vscode.window.withProgress({
							location: vscode.ProgressLocation.Notification,
							title: "Executing your prompt...",
							cancellable: true
						}, (progress, token) => {
							token.onCancellationRequested(() => {
								console.log("User canceled the generation process");

							});
				
							// Indeterminate progress indicator
							progress.report({ increment: -1 });
							
							const p = new Promise<void>(resolve => {
								// setTimeout(() => { 
								// 	resolve(); 
								// 	webviewView.webview.postMessage({ type: 'finishedGenerate' });}, 5000);
								this._generateText(request, token).then(result => {
									if (!token.isCancellationRequested && result) {
										this._showMarkdown(result).then(() => {
											resolve();
											webviewView.webview.postMessage({ type: 'finishedGenerate' });
									})}
								});
							});

							return p;
						});										

						break;
					}
			}
		});
	}

	private async _generateText(value: TransformRequest, cancel: vscode.CancellationToken): Promise<string | undefined> {
		// log the prompt to console
		const options = {
			projectId: 'cloud-blockers-ai',
			locationId: 'us-central1',
			modelId: "gemini-1.5-flash-preview-0514"
		}

		const transformer = new Transformer(options);

		cancel.onCancellationRequested(() => {
			transformer.cancel();
		});

		return transformer.generate(value);
	}

	private async _showMarkdown(response: string): Promise<void> {
		// Write to a temp file for now, in the future keep a history of responses, 
		// but probably needs the prompt injected back in too.
		const filename = this._generateFilename(vscode.workspace.workspaceFolders![0].uri.fsPath);
		const uri = vscode.Uri.file(filename);
		vscode.workspace.fs.writeFile(uri, Buffer.from(response));

		// const uri = vscode.URI.file("/path/to/file.md");
		await vscode.commands.executeCommand("markdown.showPreview", uri);
	}

	private _generateFilename(path: string): string {
		const now = new Date();
  		const timestamp = now.toISOString().replace(/[-:.]/g, ''); 
		return `${path}/temp/${timestamp}.md`;
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

		// Do the same for the stylesheet.
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading styles from our extension directory,
					and only allow scripts that have a specific nonce.
					(See the 'webview-sample' extension sample for img-src content security policy examples)
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">

			</head>
			<body>
				<h3>Scope</h3>
				<div class="radio-container">
					<input type="radio" id="fileRadio" name="sourceType" class="source-radio" value="OpenTab" checked>
					<label for="fileRadio">Active Tab</label>
					<input type="radio" id="repoRadio" name="sourceType" class="source-radio" value="Repository">
					<label for="repoRadio">Repository</label>
				</div>
				
				<div class="prompt-container">
					<h3>Enter your prompt</h3>	
					<textarea class="prompt-input"></textarea>
				</div>

				<button class="generate-button">Generate</button>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

  