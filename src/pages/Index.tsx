import { MaterialsHero } from "@/components/home/MaterialsHero";
import { FestivalDeals } from "@/components/home/FestivalDeals";
import { HeatLadder } from "@/components/home/HeatLadder";
import { FibreUpgrade } from "@/components/home/FibreUpgrade";
import { PrintMarquee } from "@/components/home/PrintMarquee";
import { PrintStory } from "@/components/story/PrintStory";
import { WhatToExpect } from "@/components/home/WhatToExpect";
import { ShopPaths } from "@/components/home/ShopPaths";

// The home page sells engineering materials first (they carry the margin):
// parts that replace metal, with the studio hero climbing spool to spool as you scroll (MaterialsHero), the material for your temperature
// (HeatLadder), then that material at work: a file becoming a race car
// (PrintStory), and what else people print and what it costs (PrintMarquee).
// Then fibre composites (FibreUpgrade), the answers before paying
// (WhatToExpect), and the rest of the shop (ShopPaths). During a festival sale,
// its printers sit right under the hero (FestivalDeals): the sale has a deadline,
// the materials story does not. The home page is dark; see ThemeScope in App.
const Index = () => (
    <div>
        <MaterialsHero />
        <FestivalDeals />
        <HeatLadder />
        <PrintStory />
        <PrintMarquee />
        <FibreUpgrade />
        <WhatToExpect />
        <ShopPaths />
    </div>
);

export default Index;
