import { defineMain } from '@storybook/react-vite/node'

export default defineMain({
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-vitest', '@storybook/addon-a11y', 'msw-storybook-addon'],
  framework: '@storybook/react-vite',
  // Serves public/mockServiceWorker.js for MSW.
  staticDirs: ['../public'],
})
