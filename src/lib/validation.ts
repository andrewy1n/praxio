export type ValidationResult = {
  valid: boolean
  errors: string[]
}

export function validateSimModule(code: string): ValidationResult {
  const checks = [
    { test: /registerParam/.test(code),      error: 'No params registered' },
    { test: /onUpdate|onRender/.test(code),  error: 'No update or render loop' },
    { test: !/document\./.test(code),        error: 'Illegal DOM access' },
    { test: !/window\./.test(code),          error: 'Illegal window access' },
    { test: !/import /.test(code),           error: 'Illegal import statement' },
    { test: !/require\(/.test(code),         error: 'Illegal require call' },
    {
      test: !/positionAt\s*\([^)]*\)\s*\.\s*(x|y)\b/.test(code),
      error: 'Invalid projectile position field access: use positionAt(t).x_m / .y_m, not .x / .y',
    },
    {
      test: !/\.\s*peak\s*\.\s*(time|x|y)\b/.test(code),
      error: 'Invalid projectile peak field access: use peak.t / peak.height_m',
    },
    {
      test: !/\bget[A-Z][\w$]*\s*\.\s*(min|max|default)\b/.test(code),
      error: 'Invalid getter metadata access: registerParam returns a getter function, not an object with .min/.max/.default',
    },
  ]
  const errors = checks.filter(c => !c.test).map(c => c.error)
  return { valid: errors.length === 0, errors }
}
