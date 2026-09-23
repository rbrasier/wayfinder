// Colours that encode data rather than brand: the "Indigo" choice in the step
// colour picker (stored on flow nodes), the default step colour, and the first
// series in the categorical chart palettes. They happen to equal Wayfinder blue
// but must not follow an install's brand colour (ADR-060 §2) — a saved step
// colour is the author's choice, and a brand colour could collide with the
// other series in a chart. The one place validate.sh lets this hex appear
// outside the token definitions.
export const DATA_INDIGO = "#2f56d3";
