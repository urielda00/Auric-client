const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    // "Mobile app design discussion" holds the approved design reference files (an
    // interactive HTML prototype), not app source — it isn't meant to pass this project's
    // lint rules.
    ignores: ['dist/*', 'Mobile app design discussion/**'],
  },
  {
    // eslint-config-expo enables the React Compiler-oriented react-hooks rules by default.
    // This app doesn't opt into the React Compiler (see app.json), and these four rules
    // false-positive against idiomatic, required patterns here:
    //  - Reanimated shared values are mutated via `.value` from worklets by design
    //    (immutability/purity/refs all fire on that, and on reading refs inside
    //    gesture-handler callbacks, e.g. the queue's drag reordering).
    //  - Loading data in a mount/query-driven `useEffect` is the standard non-compiled
    //    React Native data-fetching idiom (Home's quick picks, Search's results).
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];
