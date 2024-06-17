# Code Transformer

Very simple demonstration of using Gemini 1.5 Pro to transform either the current open tab or use the entire repository as context.  

## Sample using complete repository

![Respository](./media/repository.png)

## Sample using current open tab

![Open Tab](./media/open-tab.png)

Samples outputs were generated using the sample [ContosoUniversity](https://github.com/jjdelorme/ContosoUniversity) which is an old Microsoft sample of an ASP.NET Framework Application.

## Configuration

Create a `.vscode/launch.json` file in the project root and add the following configuration:
```diff
	{
		"version": "0.2.0",
		"configurations": [
			{
				"name": "Run Extension",
				"type": "extensionHost",
				"request": "launch",
				"runtimeExecutable": "${execPath}",
				"args": ["--extensionDevelopmentPath=${workspaceRoot}"],
				"outFiles": ["${workspaceFolder}/out/**/*.js"],
				"preLaunchTask": "npm: watch",
+				"env": {
+					"PROJECT_ID": "YOUR-PROJECT-HERE",
+					"GOOGLE_APPLICATION_CREDENTIALS": "YOUR-CREDENTIALS-JSON-HERE"
				}			
			}
		]
	}
```
