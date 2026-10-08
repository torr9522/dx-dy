import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ignores:['vendor/**','dist/**','**/generated/**']}, js.configs.recommended, ...ts.configs.recommended, {
  languageOptions: {globals: {process:'readonly', Buffer:'readonly', console:'readonly', window:'readonly', document:'readonly', fetch:'readonly', URL:'readonly', navigator:'readonly', localStorage:'readonly', setTimeout:'readonly', structuredClone:'readonly'}},
  rules: {'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}]}
});
