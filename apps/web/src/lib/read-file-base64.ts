// Reads a picked file as base64 for the tRPC procedures that take document bytes
// inline. Shared so the sample-run, template and schema-proposal uploads all
// strip the data-URL prefix the same way.
export const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
