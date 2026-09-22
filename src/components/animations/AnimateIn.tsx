import { motion } from 'framer-motion';

export const AnimateIn = ({ 
  children, 
  delay = 0, 
  className = "" 
}: { 
  children: React.ReactNode, 
  delay?: number, 
  className?: string 
}) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, y: 40 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-50px" }}
    transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
  >
    {children}
  </motion.div>
);