function validateRequiredParams(dataToUpdate) {
  if (typeof dataToUpdate !== "object" || dataToUpdate === null) {
    return dataToUpdate;
  }

  if (Array.isArray(dataToUpdate.required)) {
    const validKeys = new Set();

    if (dataToUpdate.properties && typeof dataToUpdate.properties === "object") {
      Object.keys(dataToUpdate.properties).forEach((key) => validKeys.add(key));
    }
    if (dataToUpdate.parameter && typeof dataToUpdate.parameter === "object") {
      Object.keys(dataToUpdate.parameter).forEach((key) => validKeys.add(key));
    }
    if (dataToUpdate.fields && typeof dataToUpdate.fields === "object") {
      Object.keys(dataToUpdate.fields).forEach((key) => validKeys.add(key));
    }

    dataToUpdate.required = dataToUpdate.required.filter((key) => validKeys.has(key));
  }

  for (const key in dataToUpdate) {
    if (typeof dataToUpdate[key] === "object") {
      dataToUpdate[key] = validateRequiredParams(dataToUpdate[key]);
    }
  }

  return dataToUpdate;
}

export { validateRequiredParams };
