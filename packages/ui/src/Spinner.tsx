import { Text } from "ink";
import { spinnerFrame } from "./format.js";

export interface SpinnerProps {
  readonly frame: number;
}

export function Spinner({ frame }: SpinnerProps) {
  return <Text>{spinnerFrame(frame)}</Text>;
}
