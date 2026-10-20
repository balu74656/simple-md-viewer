import { LanguageDescription, LanguageSupport, StreamLanguage, type StringStream } from '@codemirror/language';

/**
 * Zvyrazneni syntaxe PlantUML pro editor. Jednoduchy tokenizer po radcich -
 * PlantUML nema formalni gramatiku a pro barvy staci rozpoznat klicova
 * slova, sipky, retezce, komentare a direktivy.
 */

const KEYWORDS = new Set(
  `
  participant actor boundary control entity database collections queue box end
  alt else opt loop par par2 break critical group ref note over of left right top bottom
  activate deactivate destroy create autonumber return title header footer legend endlegend
  caption newpage delay hnote rnote endnote endrnote endhnote as is also on
  class interface abstract enum annotation package namespace component node cloud frame
  folder rectangle usecase artifact card file storage stack agent person port portin portout
  object map json yaml struct protocol exception metaclass circle diamond label
  state start stop kill detach if then elseif endif while endwhile repeat backward fork
  endfork split endsplit switch case endswitch partition swimlane
  skinparam hide show remove allowmixing together left to right direction
  extends implements
  `
    .trim()
    .split(/\s+/),
);

interface State {
  /** Uvnitr blokoveho komentare /' ... '/ */
  inComment: boolean;
}

function tokenComment(stream: StringStream, state: State): string {
  while (!stream.eol()) {
    if (stream.match("'/")) {
      state.inComment = false;
      return 'comment';
    }
    stream.next();
  }
  return 'comment';
}

export const plantumlLanguage = StreamLanguage.define<State>({
  name: 'plantuml',

  startState: () => ({ inComment: false }),

  token(stream, state) {
    if (state.inComment) return tokenComment(stream, state);
    if (stream.eatSpace()) return null;

    // Komentare: radkovy ' a blokovy /' ... '/
    if (stream.sol() || /^\s*$/.test(stream.string.slice(0, stream.pos))) {
      if (stream.match(/^'.*/)) return 'comment';
    }
    if (stream.match("/'")) {
      state.inComment = true;
      return tokenComment(stream, state);
    }

    // @startuml, @enduml a dalsi typy diagramu
    if (stream.match(/^@(start|end)\w+/)) return 'keyword';
    // Preprocesor: !include, !theme, !define, !procedure ...
    if (stream.match(/^!\w+/)) return 'meta';

    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^<<[^>]*>>/)) return 'typeName';
    if (stream.match(/^#[0-9a-fA-F]{6}\b|^#[0-9a-fA-F]{3}\b|^#\w+/)) return 'number';

    // Sipky: ->, -->, <-, ->>, ..>, -[#red]->, o->, <|-- ...
    if (stream.match(/^(?:[<ox*]|<\|)?(?:-+|\.+|=+)(?:\[[^\]]*\])?(?:-+|\.+)?(?:>>?|\|>|[ox*\\/]|\])?/)) {
      return 'operator';
    }
    if (stream.match(/^<-+/)) return 'operator';

    // Text zpravy za dvojteckou (A -> B : text)
    if (stream.match(/^:(?!:).*/)) return 'string';

    if (stream.match(/^[A-Za-z_][\w]*/)) {
      return KEYWORDS.has(stream.current().toLowerCase()) ? 'keyword' : 'variableName';
    }
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';

    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: "'", block: { open: "/'", close: "'/" } },
  },
});

export function plantuml(): LanguageSupport {
  return new LanguageSupport(plantumlLanguage);
}

/** Pro bloky ```plantuml uvnitr Markdownu. Jmena odpovidaji nahledu. */
export const plantumlCodeLanguage = LanguageDescription.of({
  name: 'PlantUML',
  alias: ['plantuml', 'puml', 'uml'],
  support: plantuml(),
});
