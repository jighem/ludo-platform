import React from "react";
import { View } from "react-native";
import Svg, {
  Rect,
  Circle,
  Text as SvgText,
  Polygon,
  G,
} from "react-native-svg";
import {
  type GameState,
  seatColor,
  trackCell,
} from "../../../packages/game-engine";
import {
  TRACK_COORDINATES,
  HOME_STRETCHES,
} from "../../../packages/game-engine/topology";
export const COLORS = ["#D94B4B", "#218570", "#D9A72F", "#4C72C3"];
const names = ["red", "green", "yellow", "blue"];
const yards = [
  [0, 0],
  [9, 0],
  [9, 9],
  [0, 9],
];
export function Board({
  state,
  size,
  movable,
  onToken,
}: {
  state: GameState;
  size: number;
  movable: number[];
  onToken: (token: number) => void;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: "#FFFEFB",
      }}
    >
      <Svg
        width={size}
        height={size}
        viewBox="-0.2 -0.2 15.4 15.4"
        accessibilityLabel="Ludo board"
      >
        <Rect x={0} y={0} width={15} height={15} rx={0.45} fill="#F8F6EF" />
        {yards.map(([x, y], color) => (
          <G key={`yard${color}`}>
            <Rect
              x={x + 0.15}
              y={y + 0.15}
              width={5.7}
              height={5.7}
              rx={0.4}
              fill={COLORS[color]}
              opacity={0.14}
            />
            <Rect
              x={x + 0.65}
              y={y + 0.65}
              width={4.7}
              height={4.7}
              rx={0.35}
              fill="#FFFEFB"
              stroke={COLORS[color]}
              strokeWidth={0.08}
            />
            {[
              [1.8, 1.8],
              [4.2, 1.8],
              [1.8, 4.2],
              [4.2, 4.2],
            ].map(([dx, dy], i) => (
              <Circle
                key={i}
                cx={x + dx}
                cy={y + dy}
                r={0.59}
                fill={COLORS[color]}
                opacity={0.15}
              />
            ))}
          </G>
        ))}
        {TRACK_COORDINATES.map((cell, index) => {
          const start = [0, 13, 26, 39].indexOf(index),
            safe = state.rules.safeCells.includes(index);
          return (
            <G key={`cell${index}`}>
              <Rect
                x={cell.col + 0.035}
                y={cell.row + 0.035}
                width={0.93}
                height={0.93}
                rx={0.1}
                fill={start >= 0 ? COLORS[start] : "#FFFFFF"}
                stroke="#D8DCD6"
                strokeWidth={0.035}
              />
              {safe && (
                <SvgText
                  x={cell.col + 0.5}
                  y={cell.row + 0.68}
                  textAnchor="middle"
                  fontSize={0.57}
                  fill={start >= 0 ? "#FFF" : "#63736F"}
                >
                  ✦
                </SvgText>
              )}
            </G>
          );
        })}
        {names.flatMap((name, color) =>
          HOME_STRETCHES[name]
            .slice(0, 5)
            .map((cell, index) => (
              <Rect
                key={`${name}${index}`}
                x={cell.col + 0.035}
                y={cell.row + 0.035}
                width={0.93}
                height={0.93}
                rx={0.1}
                fill={COLORS[color]}
                opacity={0.72}
              />
            )),
        )}
        <Polygon points="6,6 9,6 7.5,7.5" fill={COLORS[1]} />
        <Polygon points="9,6 9,9 7.5,7.5" fill={COLORS[2]} />
        <Polygon points="9,9 6,9 7.5,7.5" fill={COLORS[3]} />
        <Polygon points="6,9 6,6 7.5,7.5" fill={COLORS[0]} />
        {state.players.flatMap((player, seat) =>
          player.tokens.map((step, token) => {
            const color = seatColor(seat, state.players.length);
            let x: number, y: number;
            if (step === -1) {
              const base = yards[color];
              x = base[0] + [1.8, 4.2, 1.8, 4.2][token];
              y = base[1] + [1.8, 1.8, 4.2, 4.2][token];
            } else if (step === 56) {
              const centers = [
                [6.6, 7.5],
                [7.5, 6.6],
                [8.4, 7.5],
                [7.5, 8.4],
              ];
              x = centers[color][0] + (token % 2 ? 0.18 : -0.18);
              y = centers[color][1] + (token > 1 ? 0.18 : -0.18);
            } else {
              const cell =
                step >= 51
                  ? HOME_STRETCHES[names[color]][step - 51]
                  : TRACK_COORDINATES[trackCell(state, seat, step)!];
              x = cell.col + 0.5;
              y = cell.row + 0.5;
            }
            const shared =
              step >= 0 && step <= 50
                ? state.players.flatMap((p, i) =>
                    p.tokens.flatMap((t, j) =>
                      t >= 0 &&
                      t <= 50 &&
                      trackCell(state, i, t) === trackCell(state, seat, step)
                        ? [{ seat: i, token: j }]
                        : [],
                    ),
                  )
                : [];
            let scale = 1;
            if (shared.length > 1) {
              const index = shared.findIndex(
                  (p) => p.seat === seat && p.token === token,
                ),
                columns = Math.ceil(Math.sqrt(shared.length)),
                rows = Math.ceil(shared.length / columns);
              scale = 1 / columns;
              x += (((index % columns) - (columns - 1) / 2) * 0.7) / columns;
              y +=
                ((Math.floor(index / columns) - (rows - 1) / 2) * 0.7) / rows;
            }
            const active = seat === state.activeSeat && movable.includes(token),
              r = step === 56 ? 0.18 : step === -1 ? 0.43 : 0.37 * scale;
            return (
              <G
                key={`${seat}-${token}`}
                onPress={() => active && onToken(token)}
                accessibilityLabel={`${player.id}, token ${token + 1}${active ? ", movable" : ""}`}
              >
                {active && (
                  <Circle
                    cx={x}
                    cy={y}
                    r={r + 0.13}
                    fill="none"
                    stroke="#162E2A"
                    strokeWidth={0.09}
                  />
                )}
                <Circle
                  cx={x}
                  cy={y + 0.04}
                  r={r + 0.04}
                  fill="#233D37"
                  opacity={0.12}
                />
                <Circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={COLORS[color]}
                  stroke="#FFFFFF"
                  strokeWidth={0.08}
                />
                {step !== 56 && (
                  <SvgText
                    x={x}
                    y={y + 0.13 * scale}
                    textAnchor="middle"
                    fontWeight="bold"
                    fontSize={0.35 * scale}
                    fill={color === 2 ? "#273B32" : "#FFF"}
                  >
                    {token + 1}
                  </SvgText>
                )}
              </G>
            );
          }),
        )}
      </Svg>
    </View>
  );
}
