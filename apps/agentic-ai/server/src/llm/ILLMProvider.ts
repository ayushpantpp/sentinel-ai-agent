export interface ILLMProvider { generate(prompt: string): Promise<string>; }
