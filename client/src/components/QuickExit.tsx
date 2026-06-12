import { useEffect, useState } from "react";
import { X } from "lucide-react";

const ESCAPE_URL = "https://weather.com"; // innocent-looking site

const QuickExit = () => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Press Esc to trigger quick exit
      if (e.key === "Escape") {
        handleExit();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleExit = () => {
    // Replace current history entry with safe page
    window.location.replace(ESCAPE_URL);
    // Most browsers will not allow window.close() here,
    // but some might if the tab was opened by a script.
    // We try anyway, no harm if it fails.
    try {
      window.close();
    } catch (err) {
      // silently ignore
    }
  };

  if (!visible) return null;

  return (
    <button
      onClick={handleExit}
      className="fixed top-4 right-4 z-50 p-2 bg-red-600 hover:bg-red-700 text-white rounded-full shadow-lg transition-colors"
      title="Quick exit (also press Esc)"
      aria-label="Quick exit button"
    >
      <X size={20} />
    </button>
  );
};

export default QuickExit;
