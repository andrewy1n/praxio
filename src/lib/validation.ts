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
  ]
  const errors = checks.filter(c => !c.test).map(c => c.error)
  return { valid: errors.length === 0, errors }
}
