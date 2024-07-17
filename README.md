# Code Transformer

Very simple demonstration of using Gemini to transform either the current open tab or use the entire repository as context.  

## Install
	```bash
	code --install-extension vscode-transformer-0.1.3.vsix
	
	cd ~/.vscode/extensions/jjdelorme.vscode-transform-0.1.3/
	npm install
	```

## Configure

The application uses the NodeJS SDK for invoking Vertex AI with Application Default Credentials.

### Get Google Application Default Credentials
Login to generate the credentials `.json` file
	```bash
	gcloud auth application-default login

	> Credentials saved to file: [/home/YOUR_USER/.config/gcloud/application_default_credentials.json]

	```

Take the the file name above to configure settings specific to the `vscode-transformer` in VS Code User Settings UI:

![Settings](./media/settings.png)

or edit the settings file directly:

	```json
		...
		"vscode-transformer.projectId": "cloud-blockers-ai",
		"workbench.startupEditor": "none",
		"vscode-transformer.googleAdc": "/home/YOUR_USER/.config/gcloud/application_default_credentials.json",
		"vscode-transformer.include": [
			"**/*.cs",
			"**/*.aspx"
		],
		...
	```

## Sample using complete repository

![Respository](./media/repository.png)

## Sample using current open tab

![Open Tab](./media/open-tab.png)

Samples outputs were generated using the sample [ContosoUniversity](https://github.com/jjdelorme/ContosoUniversity) which is an old Microsoft sample of an ASP.NET Framework Application.
