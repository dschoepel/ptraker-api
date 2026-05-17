'use strict';

// =============================================================================
// Importer Registry
// =============================================================================
// Central registry of all available import plugins.
// To add a new institution, create a file in this directory and add it here.
//
// Each importer must export:
//   id          — unique string identifier e.g. 'lpl_csv'
//   name        — human-readable name e.g. 'LPL Financial CSV'
//   accepts     — array of file extensions e.g. ['csv']
//   institution — institution key e.g. 'lpl'
//   parse(buffer) → { positions, skipped, errors }
// =============================================================================

const importers = {
  lpl_csv:  require('./lpl.csv'),
  // lpl_qfx:     require('./lpl.qfx'),      // coming soon
  // merrill_csv: require('./merrill.csv'),   // coming soon
  // cfcu_csv:    require('./cfcu.csv'),      // coming soon
  // manual:      require('./manual'),        // coming soon
};

// Returns the importer for a given id, or null if not found
const getImporter = (importerId) => {
  return importers[importerId] || null;
};

// Returns all registered importers (for the UI to list available options)
const listImporters = () => {
  return Object.values(importers).map(imp => ({
    id: imp.id,
    name: imp.name,
    accepts: imp.accepts,
    institution: imp.institution,
    description: imp.description,
  }));
};

module.exports = { getImporter, listImporters };