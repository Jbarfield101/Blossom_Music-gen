import { useCallback, useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';

export const CELL_SIZE = 24;
export const BOARD_COLUMNS = 10;
export const BOARD_ROWS = 20;
export const CANVAS_WIDTH = BOARD_COLUMNS * CELL_SIZE;
export const CANVAS_HEIGHT = BOARD_ROWS * CELL_SIZE;

const createEmptyBoard = () =>
  Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLUMNS).fill(0));

export default function RainBlocks() {
  const canvasRef = useRef(null);
  const [board, setBoard] = useState(() => createEmptyBoard());
  const [activePiece, setActivePiece] = useState(null);
  const [gameOverMessage, setGameOverMessage] = useState(null);
  const boardRef = useRef(board);
  const activePieceRef = useRef(activePiece);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    activePieceRef.current = activePiece;
  }, [activePiece]);

  const isCellFree = useCallback((row, col) => {
    if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLUMNS) {
      return false;
    }

    return boardRef.current[row][col] === 0;
  }, []);

  const lockPiece = useCallback((piece) => {
    setBoard((previousBoard) => {
      const nextBoard = previousBoard.map((row) => row.slice());
      nextBoard[piece.row][piece.col] = 1;
      return nextBoard;
    });
  }, []);

  const spawnNewPiece = useCallback(() => {
    const startColumn = Math.floor(BOARD_COLUMNS / 2);

    if (!isCellFree(0, startColumn)) {
      setGameOverMessage('Game Over');
      setActivePiece(null);
      return false;
    }

    setActivePiece({ row: 0, col: startColumn });
    return true;
  }, [isCellFree]);

  const movePieceHorizontally = useCallback(
    (direction) => {
      setActivePiece((piece) => {
        if (!piece) {
          return piece;
        }

        const nextColumn = piece.col + direction;
        if (!isCellFree(piece.row, nextColumn)) {
          return piece;
        }

        return { row: piece.row, col: nextColumn };
      });
    },
    [isCellFree],
  );

  useEffect(() => {
    if (!gameOverMessage && !activePiece) {
      spawnNewPiece();
    }
  }, [activePiece, gameOverMessage, spawnNewPiece]);

  useEffect(() => {
    if (gameOverMessage) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      setActivePiece((piece) => {
        if (!piece) {
          return piece;
        }

        const nextRow = piece.row + 1;
        if (nextRow >= BOARD_ROWS || !isCellFree(nextRow, piece.col)) {
          lockPiece(piece);
          return null;
        }

        return { row: nextRow, col: piece.col };
      });
    }, 200);

    return () => {
      clearInterval(intervalId);
    };
  }, [gameOverMessage, isCellFree, lockPiece]);

  useEffect(() => {
    if (gameOverMessage) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (!activePieceRef.current) {
        return;
      }

      if (event.key === 'a' || event.key === 'ArrowLeft') {
        event.preventDefault();
        movePieceHorizontally(-1);
      } else if (event.key === 'd' || event.key === 'ArrowRight') {
        event.preventDefault();
        movePieceHorizontally(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [gameOverMessage, movePieceHorizontally]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    context.fillStyle = '#111827';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    context.fillStyle = '#2563eb';
    board.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        if (cell) {
          context.fillRect(
            columnIndex * CELL_SIZE,
            rowIndex * CELL_SIZE,
            CELL_SIZE,
            CELL_SIZE,
          );
        }
      });
    });

    if (activePiece) {
      context.fillStyle = '#38bdf8';
      context.fillRect(
        activePiece.col * CELL_SIZE,
        activePiece.row * CELL_SIZE,
        CELL_SIZE,
        CELL_SIZE,
      );
    }
  }, [activePiece, board]);

  useEffect(() => {
    if (!gameOverMessage) {
      return undefined;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(17, 24, 39, 0.75)';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    return undefined;
  }, [gameOverMessage]);

  return (
    <>
      <BackButton />
      <h1>Rain Blocks</h1>
      {gameOverMessage && (
        <p className="game-over-message">{gameOverMessage}</p>
      )}
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="game-canvas"
      ></canvas>
    </>
  );
}
