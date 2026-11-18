export interface ColorTokens {
  readonly background: string;
}

export const colorTokens: {
  readonly light: Partial<ColorTokens>;
  readonly dark: Partial<ColorTokens>;
} = { light: {}, dark: {} };
