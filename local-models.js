const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

class LocalModels {
  constructor(config = {}) {
    this.ollamaHost = config.ollamaHost || 'http://localhost:11434';
    this.defaultTextModel = config.defaultTextModel || 'llama3.2';
    this.defaultVisionModel = config.defaultVisionModel || 'llava';
    this.outputDir = config.outputDir || './outputs';
    
    // Ensure output directory exists
    this.ensureOutputDir();
  }

  async ensureOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      await fs.mkdir(path.join(this.outputDir, 'images'), { recursive: true });
      await fs.mkdir(path.join(this.outputDir, 'text'), { recursive: true });
    } catch (error) {
      console.error('Error creating output directories:', error);
    }
  }

  /**
   * Check if Ollama is running and available
   */
  async checkOllamaAvailable() {
    try {
      const response = await fetch(`${this.ollamaHost}/api/tags`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * List available Ollama models
   */
  async listModels() {
    try {
      const response = await fetch(`${this.ollamaHost}/api/tags`);
      if (!response.ok) {
        throw new Error('Ollama not available');
      }
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      console.error('Error listing models:', error);
      return [];
    }
  }

  /**
   * Generate text using a local LLM via Ollama
   */
  async generateText(prompt, options = {}) {
    const model = options.model || this.defaultTextModel;
    const temperature = options.temperature || 0.7;
    const maxTokens = options.maxTokens || 2048;
    const stream = options.stream || false;

    try {
      const response = await fetch(`${this.ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          stream: stream,
          options: {
            temperature: temperature,
            num_predict: maxTokens
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      if (stream) {
        return response.body;
      } else {
        const lines = (await response.text()).trim().split('\n');
        let fullResponse = '';
        
        for (const line of lines) {
          if (line) {
            const json = JSON.parse(line);
            fullResponse += json.response || '';
          }
        }
        
        return fullResponse;
      }
    } catch (error) {
      console.error('Error generating text:', error);
      throw error;
    }
  }

  /**
   * Generate text with streaming support
   */
  async generateTextStream(prompt, options = {}, onChunk) {
    const model = options.model || this.defaultTextModel;
    const temperature = options.temperature || 0.7;
    const maxTokens = options.maxTokens || 2048;

    try {
      const response = await fetch(`${this.ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          stream: true,
          options: {
            temperature: temperature,
            num_predict: maxTokens
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.response) {
              fullResponse += json.response;
              if (onChunk) {
                onChunk(json.response);
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }

      return fullResponse;
    } catch (error) {
      console.error('Error generating text stream:', error);
      throw error;
    }
  }

  /**
   * Chat with a local LLM (maintains conversation context)
   */
  async chat(messages, options = {}) {
    const model = options.model || this.defaultTextModel;
    const temperature = options.temperature || 0.7;

    try {
      const response = await fetch(`${this.ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          messages: messages,
          stream: false,
          options: {
            temperature: temperature
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.message.content;
    } catch (error) {
      console.error('Error in chat:', error);
      throw error;
    }
  }

  /**
   * Generate an image using Stable Diffusion via ComfyUI or Automatic1111
   * Requires external setup of SD WebUI or ComfyUI
   */
  async generateImage(prompt, options = {}) {
    const method = options.method || 'automatic1111'; // or 'comfyui'
    const negativePrompt = options.negativePrompt || 'blurry, low quality, distorted';
    const width = options.width || 512;
    const height = options.height || 512;
    const steps = options.steps || 20;
    const seed = options.seed || -1;

    try {
      if (method === 'automatic1111') {
        return await this.generateImageAutomatic1111(prompt, {
          negativePrompt,
          width,
          height,
          steps,
          seed
        });
      } else if (method === 'comfyui') {
        return await this.generateImageComfyUI(prompt, options);
      } else {
        throw new Error(`Unknown image generation method: ${method}`);
      }
    } catch (error) {
      console.error('Error generating image:', error);
      throw error;
    }
  }

  /**
   * Generate image using Automatic1111 Stable Diffusion WebUI API
   */
  async generateImageAutomatic1111(prompt, options = {}) {
    const apiUrl = options.apiUrl || 'http://localhost:7860';
    
    try {
      const response = await fetch(`${apiUrl}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          negative_prompt: options.negativePrompt || 'blurry, low quality',
          width: options.width || 512,
          height: options.height || 512,
          steps: options.steps || 20,
          seed: options.seed || -1,
          sampler_name: options.sampler || 'DPM++ 2M Karras',
          cfg_scale: options.cfgScale || 7
        })
      });

      if (!response.ok) {
        throw new Error(`Automatic1111 API error: ${response.statusText}`);
      }

      const data = await response.json();
      const imageData = data.images[0]; // Base64 encoded image
      
      // Save to file
      const timestamp = Date.now();
      const filename = `sd_${timestamp}.png`;
      const filepath = path.join(this.outputDir, 'images', filename);
      
      await fs.writeFile(filepath, Buffer.from(imageData, 'base64'));
      
      return {
        success: true,
        filepath: filepath,
        filename: filename,
        prompt: prompt,
        seed: data.info ? JSON.parse(data.info).seed : options.seed
      };
    } catch (error) {
      console.error('Error with Automatic1111:', error);
      throw error;
    }
  }

  /**
   * Check if Stable Diffusion WebUI is running
   */
  async checkSDWebUIAvailable(apiUrl = 'http://localhost:7860') {
    try {
      const response = await fetch(`${apiUrl}/sdapi/v1/sd-models`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Analyze an image using a vision model (like LLaVA)
   */
  async analyzeImage(imagePath, prompt = 'Describe this image in detail', options = {}) {
    const model = options.model || this.defaultVisionModel;

    try {
      // Read image and convert to base64
      const imageBuffer = await fs.readFile(imagePath);
      const imageBase64 = imageBuffer.toString('base64');

      const response = await fetch(`${this.ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          images: [imageBase64],
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const lines = (await response.text()).trim().split('\n');
      let fullResponse = '';
      
      for (const line of lines) {
        if (line) {
          const json = JSON.parse(line);
          fullResponse += json.response || '';
        }
      }
      
      return fullResponse;
    } catch (error) {
      console.error('Error analyzing image:', error);
      throw error;
    }
  }

  /**
   * Save text output to a file
   */
  async saveTextOutput(content, filename) {
    const filepath = path.join(this.outputDir, 'text', filename);
    await fs.writeFile(filepath, content, 'utf8');
    return filepath;
  }

  /**
   * Get status of all local model services
   */
  async getServicesStatus() {
    const status = {
      ollama: await this.checkOllamaAvailable(),
      sdWebUI: await this.checkSDWebUIAvailable(),
      models: []
    };

    if (status.ollama) {
      status.models = await this.listModels();
    }

    return status;
  }
}

module.exports = LocalModels;
