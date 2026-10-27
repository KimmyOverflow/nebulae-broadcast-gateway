import type { Configuration } from "webpack"
import nodeExternals from "webpack-node-externals"

const config: Configuration = {
    mode: 'development',
    target: 'node',
    entry: './src/index.ts',
    module: {
        rules: [
            {
                test: /\.ts?$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ]
    },
    resolve: {
        extensions: ['.mjs', '.js', '.ts']
    },
    output: {
        filename: 'prod.js'
    },
    externals: [nodeExternals()]
}

export default config