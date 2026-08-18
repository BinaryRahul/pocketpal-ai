module.exports = {
  root: true,
  extends: ['@react-native', 'plugin:prettier/recommended'],
  ignorePatterns: [
    'coverage/',
    'node_modules/',
    'android/',
    'ios/',
    'build/',
    'dist/',
  ],
  rules: {
    'prettier/prettier': 'error',
  },
};
