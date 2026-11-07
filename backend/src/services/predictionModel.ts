import { pool } from "../db/pool";

interface TrainingBet {
  odds: string;
  result: "win" | "loss";
}

export interface OddsCalibration {
  algorithm: string;
  status: "trained" | "insufficient_history";
  sampleSize: number;
  minimumSampleSize: number;
  brierScore: number | null;
  predict: (decimalOdds: number) => number | null;
}

const MINIMUM_SAMPLE_SIZE = 50;

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, value))));
}

export async function trainOddsCalibration(userId: number): Promise<OddsCalibration> {
  const { rows } = await pool.query<TrainingBet>(
    `SELECT odds::text, result FROM bets WHERE user_id=$1 AND result IN ('win','loss')
     ORDER BY bet_date DESC LIMIT 2000`,
    [userId],
  );
  const samples = rows.map((row) => ({
    feature: Math.log((1 / Number(row.odds)) / (1 - 1 / Number(row.odds))),
    label: row.result === "win" ? 1 : 0,
  })).filter((sample) => Number.isFinite(sample.feature));
  if (samples.length < MINIMUM_SAMPLE_SIZE) {
    return {
      algorithm: "Regularized logistic odds calibration",
      status: "insufficient_history",
      sampleSize: samples.length,
      minimumSampleSize: MINIMUM_SAMPLE_SIZE,
      brierScore: null,
      predict: () => null,
    };
  }

  let intercept = 0;
  let slope = 1;
  const learningRate = 0.03;
  const regularization = 0.02;
  for (let epoch = 0; epoch < 1800; epoch += 1) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    for (const sample of samples) {
      const error = sigmoid(intercept + slope * sample.feature) - sample.label;
      interceptGradient += error;
      slopeGradient += error * sample.feature;
    }
    intercept -= learningRate * interceptGradient / samples.length;
    slope -= learningRate * (slopeGradient / samples.length + regularization * (slope - 1));
  }
  const predict = (decimalOdds: number) => {
    if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return null;
    const implied = 1 / decimalOdds;
    const feature = Math.log(implied / (1 - implied));
    return Math.max(0.01, Math.min(0.99, sigmoid(intercept + slope * feature)));
  };
  const brierScore = samples.reduce((total, sample) => {
    const probability = predict(1 / sigmoid(sample.feature));
    return total + ((probability ?? 0.5) - sample.label) ** 2;
  }, 0) / samples.length;
  return {
    algorithm: "Regularized logistic odds calibration",
    status: "trained",
    sampleSize: samples.length,
    minimumSampleSize: MINIMUM_SAMPLE_SIZE,
    brierScore,
    predict,
  };
}
