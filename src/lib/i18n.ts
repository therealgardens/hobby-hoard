import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

const resources = {
  en: { translation: {
    nav: { home: "Home", master: "Master Sets", search: "Search", binders: "Binders", wanted: "Wanted", duplicates: "Duplicates", pokedex: "Pokédex", decks: "Decks", settings: "Settings", switch: "Switch", signOut: "Sign out" },
    settings: {
      title: "Settings",
      appearance: "Appearance", theme: "Theme", light: "Light", dark: "Dark", system: "System",
      language: "Language", languageDesc: "Choose your preferred language",
      data: "Data", export: "Export collection", exportDesc: "Download your full collection as JSON",
      import: "Import collection", importDesc: "Restore from a previously exported file",
      account: "Account", danger: "Danger zone",
      deleteAccount: "Delete account", deleteDesc: "Permanently delete your account and all data. This cannot be undone.",
      confirmDelete: "Are you absolutely sure?", confirmDeleteDesc: "This will permanently delete your account, collections, binders, decks and wishlists.",
      cancel: "Cancel", confirm: "Yes, delete everything",
      exported: "Collection exported", imported: "Collection imported", importError: "Import failed",
      deleted: "Account deleted",
    },
  }},
  fr: { translation: {
    nav: { home: "Accueil", master: "Sets complets", search: "Recherche", binders: "Classeurs", wanted: "Recherchées", duplicates: "Doublons", pokedex: "Pokédex", decks: "Decks", settings: "Paramètres", switch: "Changer", signOut: "Déconnexion" },
    settings: {
      title: "Paramètres",
      appearance: "Apparence", theme: "Thème", light: "Clair", dark: "Sombre", system: "Système",
      language: "Langue", languageDesc: "Choisissez votre langue préférée",
      data: "Données", export: "Exporter la collection", exportDesc: "Télécharger votre collection au format JSON",
      import: "Importer une collection", importDesc: "Restaurer depuis un fichier exporté",
      account: "Compte", danger: "Zone dangereuse",
      deleteAccount: "Supprimer le compte", deleteDesc: "Supprimer définitivement votre compte et toutes vos données. Irréversible.",
      confirmDelete: "Êtes-vous absolument sûr ?", confirmDeleteDesc: "Cela supprimera définitivement votre compte, vos collections, classeurs, decks et listes.",
      cancel: "Annuler", confirm: "Oui, tout supprimer",
      exported: "Collection exportée", imported: "Collection importée", importError: "Échec de l'import",
      deleted: "Compte supprimé",
    },
  }},
  es: { translation: {
    nav: { home: "Inicio", master: "Sets completos", search: "Buscar", binders: "Carpetas", wanted: "Buscadas", duplicates: "Duplicados", pokedex: "Pokédex", decks: "Mazos", settings: "Ajustes", switch: "Cambiar", signOut: "Cerrar sesión" },
    settings: {
      title: "Ajustes",
      appearance: "Apariencia", theme: "Tema", light: "Claro", dark: "Oscuro", system: "Sistema",
      language: "Idioma", languageDesc: "Elige tu idioma preferido",
      data: "Datos", export: "Exportar colección", exportDesc: "Descarga tu colección completa en JSON",
      import: "Importar colección", importDesc: "Restaurar desde un archivo exportado",
      account: "Cuenta", danger: "Zona de peligro",
      deleteAccount: "Eliminar cuenta", deleteDesc: "Eliminar permanentemente tu cuenta y todos los datos. No se puede deshacer.",
      confirmDelete: "¿Estás absolutamente seguro?", confirmDeleteDesc: "Esto eliminará permanentemente tu cuenta, colecciones, carpetas, mazos y listas.",
      cancel: "Cancelar", confirm: "Sí, eliminar todo",
      exported: "Colección exportada", imported: "Colección importada", importError: "Error al importar",
      deleted: "Cuenta eliminada",
    },
  }},
  de: { translation: {
    nav: { home: "Start", master: "Komplette Sets", search: "Suche", binders: "Ordner", wanted: "Gesucht", duplicates: "Duplikate", pokedex: "Pokédex", decks: "Decks", settings: "Einstellungen", switch: "Wechseln", signOut: "Abmelden" },
    settings: {
      title: "Einstellungen",
      appearance: "Aussehen", theme: "Design", light: "Hell", dark: "Dunkel", system: "System",
      language: "Sprache", languageDesc: "Wähle deine bevorzugte Sprache",
      data: "Daten", export: "Sammlung exportieren", exportDesc: "Lade deine Sammlung als JSON herunter",
      import: "Sammlung importieren", importDesc: "Aus einer exportierten Datei wiederherstellen",
      account: "Konto", danger: "Gefahrenzone",
      deleteAccount: "Konto löschen", deleteDesc: "Konto und alle Daten dauerhaft löschen. Nicht rückgängig zu machen.",
      confirmDelete: "Bist du absolut sicher?", confirmDeleteDesc: "Dies löscht dauerhaft dein Konto, Sammlungen, Ordner, Decks und Listen.",
      cancel: "Abbrechen", confirm: "Ja, alles löschen",
      exported: "Sammlung exportiert", imported: "Sammlung importiert", importError: "Import fehlgeschlagen",
      deleted: "Konto gelöscht",
    },
  }},
  it: { translation: {
    nav: { home: "Home", master: "Set completi", search: "Cerca", binders: "Raccoglitori", wanted: "Cercate", duplicates: "Duplicati", pokedex: "Pokédex", decks: "Mazzi", settings: "Impostazioni", switch: "Cambia", signOut: "Esci" },
    settings: {
      title: "Impostazioni",
      appearance: "Aspetto", theme: "Tema", light: "Chiaro", dark: "Scuro", system: "Sistema",
      language: "Lingua", languageDesc: "Scegli la tua lingua preferita",
      data: "Dati", export: "Esporta collezione", exportDesc: "Scarica la collezione in JSON",
      import: "Importa collezione", importDesc: "Ripristina da un file esportato",
      account: "Account", danger: "Zona pericolosa",
      deleteAccount: "Elimina account", deleteDesc: "Elimina definitivamente account e dati. Irreversibile.",
      confirmDelete: "Sei assolutamente sicuro?", confirmDeleteDesc: "Questo eliminerà definitivamente account, collezioni, raccoglitori, mazzi e liste.",
      cancel: "Annulla", confirm: "Sì, elimina tutto",
      exported: "Collezione esportata", imported: "Collezione importata", importError: "Importazione fallita",
      deleted: "Account eliminato",
    },
  }},
  pt: { translation: {
    nav: { home: "Início", master: "Sets completos", search: "Buscar", binders: "Pastas", wanted: "Procuradas", duplicates: "Duplicadas", pokedex: "Pokédex", decks: "Decks", settings: "Configurações", switch: "Trocar", signOut: "Sair" },
    settings: {
      title: "Configurações",
      appearance: "Aparência", theme: "Tema", light: "Claro", dark: "Escuro", system: "Sistema",
      language: "Idioma", languageDesc: "Escolha o idioma preferido",
      data: "Dados", export: "Exportar coleção", exportDesc: "Baixe sua coleção em JSON",
      import: "Importar coleção", importDesc: "Restaurar de um arquivo exportado",
      account: "Conta", danger: "Zona de perigo",
      deleteAccount: "Excluir conta", deleteDesc: "Excluir permanentemente sua conta e dados. Não pode ser desfeito.",
      confirmDelete: "Tem certeza absoluta?", confirmDeleteDesc: "Isso excluirá permanentemente sua conta, coleções, pastas, decks e listas.",
      cancel: "Cancelar", confirm: "Sim, excluir tudo",
      exported: "Coleção exportada", imported: "Coleção importada", importError: "Falha na importação",
      deleted: "Conta excluída",
    },
  }},
  ja: { translation: {
    nav: { home: "ホーム", master: "マスターセット", search: "検索", binders: "バインダー", wanted: "ほしいもの", duplicates: "ダブり", pokedex: "ポケモン図鑑", decks: "デッキ", settings: "設定", switch: "切替", signOut: "ログアウト" },
    settings: {
      title: "設定",
      appearance: "外観", theme: "テーマ", light: "ライト", dark: "ダーク", system: "システム",
      language: "言語", languageDesc: "好みの言語を選択",
      data: "データ", export: "コレクションをエクスポート", exportDesc: "コレクションをJSONでダウンロード",
      import: "コレクションをインポート", importDesc: "エクスポート済みファイルから復元",
      account: "アカウント", danger: "危険ゾーン",
      deleteAccount: "アカウント削除", deleteDesc: "アカウントとすべてのデータを完全に削除します。元に戻せません。",
      confirmDelete: "本当によろしいですか？", confirmDeleteDesc: "アカウント、コレクション、バインダー、デッキ、リストが完全に削除されます。",
      cancel: "キャンセル", confirm: "はい、すべて削除",
      exported: "エクスポートしました", imported: "インポートしました", importError: "インポート失敗",
      deleted: "アカウントを削除しました",
    },
  }},
};

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "ja", label: "日本語" },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: LANGUAGES.map((l) => l.code),
    interpolation: { escapeValue: false },
    detection: { order: ["localStorage", "navigator"], caches: ["localStorage"] },
  });

export default i18n;
