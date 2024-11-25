import terser from "@rollup/plugin-terser";
import obfuscator from "rollup-plugin-obfuscator";

export default [
  {
    input: "src/lynq.js",
    output: {
      file: "dist/lynq.min.js",
      format: "iife",
    },
    plugins: [
      terser(),
      obfuscator({
        compact: true,
        controlFlowFlattening: true,
        deadCodeInjection: true,
        debugProtection: true,
        disableConsoleOutput: true,
        identifierNamesGenerator: "hexadecimal",
        selfDefending: true,
        stringArray: true,
      }),
    ],
  },
  {
    input: "src/stub.js",
    output: {
      file: "dist/stub.min.js",
      format: "iife",
    },
    plugins: [terser()],
  },
];
