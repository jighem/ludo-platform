export interface Cell {
  row: number;
  col: number;
}
export const TRACK_COORDINATES: Cell[] = [
  { row: 6, col: 1 }, // 0: Red Start (Safe)
  { row: 6, col: 2 }, // 1
  { row: 6, col: 3 }, // 2
  { row: 6, col: 4 }, // 3
  { row: 6, col: 5 }, // 4
  { row: 5, col: 6 }, // 5
  { row: 4, col: 6 }, // 6
  { row: 3, col: 6 }, // 7
  { row: 2, col: 6 }, // 8: Safe Star (Green track entry star)
  { row: 1, col: 6 }, // 9
  { row: 0, col: 6 }, // 10
  { row: 0, col: 7 }, // 11
  { row: 0, col: 8 }, // 12
  { row: 1, col: 8 }, // 13: Green Start (Safe)
  { row: 2, col: 8 }, // 14
  { row: 3, col: 8 }, // 15
  { row: 4, col: 8 }, // 16
  { row: 5, col: 8 }, // 17
  { row: 6, col: 9 }, // 18
  { row: 6, col: 10 }, // 19
  { row: 6, col: 11 }, // 20
  { row: 6, col: 12 }, // 21: Safe Star (Yellow track entry star)
  { row: 6, col: 13 }, // 22
  { row: 6, col: 14 }, // 23
  { row: 7, col: 14 }, // 24
  { row: 8, col: 14 }, // 25
  { row: 8, col: 13 }, // 26: Yellow Start (Safe)
  { row: 8, col: 12 }, // 27
  { row: 8, col: 11 }, // 28
  { row: 8, col: 10 }, // 29
  { row: 8, col: 9 }, // 30
  { row: 9, col: 8 }, // 31
  { row: 10, col: 8 }, // 32
  { row: 11, col: 8 }, // 33
  { row: 12, col: 8 }, // 34: Safe Star (Blue track entry star)
  { row: 13, col: 8 }, // 35
  { row: 14, col: 8 }, // 36
  { row: 14, col: 7 }, // 37
  { row: 14, col: 6 }, // 38
  { row: 13, col: 6 }, // 39: Blue Start (Safe)
  { row: 12, col: 6 }, // 40
  { row: 11, col: 6 }, // 41
  { row: 10, col: 6 }, // 42
  { row: 9, col: 6 }, // 43
  { row: 8, col: 5 }, // 44
  { row: 8, col: 4 }, // 45
  { row: 8, col: 3 }, // 46
  { row: 8, col: 2 }, // 47: Safe Star (Red track entry star)
  { row: 8, col: 1 }, // 48
  { row: 8, col: 0 }, // 49
  { row: 7, col: 0 }, // 50
  { row: 6, col: 0 }, // 51
];

// Home stretches for each color (steps 51 to 55, and 56 = Center Finish)
export const HOME_STRETCHES: Record<string, Cell[]> = {
  red: [
    { row: 7, col: 1 }, // 51
    { row: 7, col: 2 }, // 52
    { row: 7, col: 3 }, // 53
    { row: 7, col: 4 }, // 54
    { row: 7, col: 5 }, // 55
    { row: 7, col: 6 }, // 56
  ],
  green: [
    { row: 1, col: 7 }, // 51
    { row: 2, col: 7 }, // 52
    { row: 3, col: 7 }, // 53
    { row: 4, col: 7 }, // 54
    { row: 5, col: 7 }, // 55
    { row: 6, col: 7 }, // 56
  ],
  yellow: [
    { row: 7, col: 13 }, // 51
    { row: 7, col: 12 }, // 52
    { row: 7, col: 11 }, // 53
    { row: 7, col: 10 }, // 54
    { row: 7, col: 9 }, // 55
    { row: 7, col: 8 }, // 56
  ],
  blue: [
    { row: 13, col: 7 }, // 51
    { row: 12, col: 7 }, // 52
    { row: 11, col: 7 }, // 53
    { row: 10, col: 7 }, // 54
    { row: 9, col: 7 }, // 55
    { row: 8, col: 7 }, // 56
  ],
};
