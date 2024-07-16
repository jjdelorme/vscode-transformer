//@ts-check

// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    const vscode = acquireVsCodeApi();
   
    document.querySelector('.generate-button')?.addEventListener('click', () => {
        onGenerateClicked();
    });

    
    const cacheCheckbox = document.querySelector('input#cacheCheckbox');
    
    if (cacheCheckbox) {
        // Disable onload.
        cacheCheckbox.setAttribute('disabled', 'true');

        const radioButtons = document.querySelectorAll('.source-radio');
        
        // Handle on change
        radioButtons.forEach(radioButton => {
            radioButton.addEventListener('change', () => {
                if (radioButton.id === 'repoRadio') {
                    cacheCheckbox.removeAttribute('disabled');
                } else {
                    cacheCheckbox.setAttribute('disabled', 'true');
                }
            });
        });
    }

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

        // Get the selected model value
        const selectedModel = document.querySelector('.model-selector select').value;

        const useContextCache = cacheCheckbox?.checked;

        document.querySelector('.generate-button')?.classList.add('generate-button-disabled');

        vscode.postMessage({ type: 'generateText', value: { 
            prompt: prompt, 
            sourceType: sourceType,
            model: selectedModel,
            useCache: useContextCache,
        } });
    }

    /**
     * Clears the prompt output.
     */
    function clearPrompt() {
        document.querySelector('.prompt-input').value = '';
    }
}());
