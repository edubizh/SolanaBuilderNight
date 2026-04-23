export default function handler(req, res) {
  res.status(200).json({
    status: "ok",
    service: "solana-builder-night-staging",
    timestamp: new Date().toISOString(),
  });
}
