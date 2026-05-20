/**
 * Importer registry
 * Each importer exports: id, name, description, fileTypes, institutions
 * CSV importers also export: parse(buffer) → rows[]
 * OFX/QFX importer exports: parseOFXFile(buffer), matchAccounts(parsed, dbAccounts)
 */

module.exports = {
  lpl_csv:  require('./lpl_csv'),
  cfcu_csv: require('./cfcu_csv'),
  ofx_qfx:  require('./ofx_qfx'),
  manual:   require('./manual'),
};
