import { motion } from 'framer-motion';

export const BlurText = ({ text, className = "" }: { text: string, className?: string }) => {
  const words = text.split(" ");
  return (
    <h1 className={`flex flex-wrap ${className}`}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ filter: 'blur(10px)', opacity: 0, y: 10 }}
          animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: i * 0.1, ease: "easeOut" }}
          className="mr-2 lg:mr-3"
        >
          {word}
        </motion.span>
      ))}
    </h1>
  );
};