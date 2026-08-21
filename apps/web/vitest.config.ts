import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node, not jsdom: what is tested here is the store's logic, and giving it
    // a DOM it does not use would only make the suite slower and vaguer.
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
