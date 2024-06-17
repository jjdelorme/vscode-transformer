# Code Transformer

Very simple demonstration of using Gemini 1.5 Pro to transform either the current open tab or use the entire repository as context.  

## Configuration

The application uses the NodeJS SDK for invoking Vertex AI with Application Default Credentials. Configure this json file, project Id and other settings specific to the `vscode-transformer` in VS Code User Settings:

![Settings](./media/settings.png)

## Install
	```bash
	code --install-extension vscode-transformer-0.0.2.vsix
	
	cd ~/.vscode/extensions/jjdelorme.vscode-transform-0.0.2/
	npm install
	```

## Sample using complete repository

![Respository](./media/repository.png)

## Sample using current open tab

![Open Tab](./media/open-tab.png)

Samples outputs were generated using the sample [ContosoUniversity](https://github.com/jjdelorme/ContosoUniversity) which is an old Microsoft sample of an ASP.NET Framework Application.


code --install-extension vscode-transformer-0.0.2.vsix