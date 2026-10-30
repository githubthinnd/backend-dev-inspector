// Import this first: the inspector only turns on outside production, and `NODE_ENV` is read when it starts.
process.env.NODE_ENV ??= "development"
