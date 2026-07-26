// src/utils/error.ts
function describeError(err) {
  return err instanceof Error ? err.message : String(err);
}

export {
  describeError
};
