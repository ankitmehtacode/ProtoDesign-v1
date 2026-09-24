import { Hero } from "@/components/Hero";
import { PrintStory } from "@/components/story/PrintStory";
import { ThreePaths } from "@/components/story/ThreePaths";

// The home page reads as one story: the promise (Hero), how an idea becomes an
// object and the ask (PrintStory), then the ways in (ThreePaths).
const Index = () => {
  return (
    <div>
      <Hero />
      <PrintStory />
      <ThreePaths />
    </div>
  );
};

export default Index;
