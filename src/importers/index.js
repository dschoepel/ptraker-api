'use strict';

const importers = {
  lpl_csv:  require('./lpl.csv'),
  cfcu_csv: require('./cfcu.csv'),
  manual:   require('./manual'),
  // lpl_qfx:     require('./lpl.qfx'),      // planned
  // merrill_csv: require('./merrill.csv'),   // planned
  // schwab_csv:  require('./schwab.csv'),    // planned
};

const getImporter = (importerId) => importers[importerId] || null;

const listImporters = () => Object.values(importers).map(imp => ({
  id:          imp.id,
  name:        imp.name,
  accepts:     imp.accepts,
  institution: imp.institution,
  description: imp.description,
  isManual:    imp.isManual || false,
}));

module.exports = { getImporter, listImporters };
