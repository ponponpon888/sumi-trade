import packageJson from "../../package.json";

/**
 * 本番ヘルスチェックはこの値とpackage.jsonのversionを突き合わせて
 * 新しいビルドの反映を待つ。直書きにすると両者がずれてチェックが
 * 永久にリトライするため、package.jsonを唯一の出所とする。
 */
export const BUILD_VERSION: string = packageJson.version;
