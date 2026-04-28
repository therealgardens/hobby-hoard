import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import GameLayout from "./components/GameLayout";
import GameHome from "./pages/game/GameHome";
import MasterSets from "./pages/game/MasterSets";
import Binders from "./pages/game/Binders";
import BinderDetail from "./pages/game/BinderDetail";
import Wanted from "./pages/game/Wanted";
import Duplicates from "./pages/game/Duplicates";
import Pokedex from "./pages/game/Pokedex";
import Decks from "./pages/game/Decks";
import CardSearchPage from "./pages/game/CardSearchPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/:game" element={<ProtectedRoute><GameLayout /></ProtectedRoute>}>
              <Route index element={<GameHome />} />
              <Route path="master" element={<MasterSets />} />
              <Route path="search" element={<CardSearchPage />} />
              <Route path="binders" element={<Binders />} />
              <Route path="binders/:binderId" element={<BinderDetail />} />
              <Route path="wanted" element={<Wanted />} />
              <Route path="duplicates" element={<Duplicates />} />
              <Route path="pokedex" element={<Pokedex />} />
              <Route path="decks" element={<Decks />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
