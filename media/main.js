//@ts-check

// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    const vscode = acquireVsCodeApi();
   
    document.querySelector('.generate-button')?.addEventListener('click', () => {
        onGenerateClicked();
    });

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.type) {
            case 'finishedGenerate':
                {
                    document.querySelector('.generate-button')?.classList.remove('generate-button-disabled');
                    break;
                }
            case 'clearPrompt':
                {
                    clearPrompt();
                    break;
                }
        }
    });

    /** 
     * Reads the prompt and sends it to the extension host.
     */
    function onGenerateClicked() {
        const prompt = document.querySelector('.prompt-input').value;
        if (!prompt) {
            return;
        }
        const sourceType = document.querySelector('.source-radio:checked').value ?? 'OpenTab';

        document.querySelector('.generate-button')?.classList.add('generate-button-disabled');

        vscode.postMessage({ type: 'generateText', value: { prompt: prompt, sourceType: sourceType } });
    }

    /**
     * Clears the prompt output.
     */
    function clearPrompt() {
        document.querySelector('.prompt-input').value = '';
    }
}());
