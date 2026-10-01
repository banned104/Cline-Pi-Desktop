/**
 * ClinePass provider plugin.
 *
 * Everything this plugin contributes is declared in `manifest.json`
 * (`contributes.providers`). host-core materializes the provider row from that
 * declaration when the plugin loads and reconciles it on every startup, so
 * there is no runtime behavior to implement here.
 *
 * The `main` entry is a no-op that exists only because every plugin manifest
 * must name one. The API key is not part of the package: it is stored through
 * the app's secret store and entered in Settings > Providers after install.
 */
module.exports = {};
