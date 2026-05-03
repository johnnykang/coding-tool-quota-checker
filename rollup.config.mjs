import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";

const isWatching = !!process.env.ROLLUP_WATCH;

/**
 * @type {import('rollup').RollupOptions}
 */
export default {
	input: "src/plugin.ts",
	output: {
		file: "au.jkang.codingtoolquotachecker.sdPlugin/bin/plugin.js",
		format: "esm",
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return path.resolve(path.dirname(sourcemapPath), relativeSourcePath);
		}
	},
	plugins: [
		typescript(),
		resolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		}),
		commonjs(),
		!isWatching && terser()
	]
};
