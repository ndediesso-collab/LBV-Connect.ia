/**
 * ORIA Math — rendu scientifique Mobile (Expo SDK 58).
 * - SVG MathJax 3.2.2 : matrices, aligned, cases, integrales, tenseurs.
 * - Expressions longues : defilement interne et lecteur agrandi.
 * - Source TeX traite comme une donnee HTML echappee, jamais comme du JavaScript.
 * - Chargement MathJax par CDN HTTPS : connexion requise (integration offline future).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

export type OriaMathVariant = 'body' | 'h1' | 'h2' | 'h3' | 'quote';
type MathViewMode = 'inline' | 'display';
type MathTheme = { isDark: boolean; language?: 'fr' | 'en' };

const MATHJAX_CDN = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js';
const MAX_LATEX_CHARACTERS = 180_000;

const TOKENS = /(\\\([^\n]*?\\\)|\$(?!\s)[^$\n]*?\S\$|\b[A-Za-z](?:(?:_(?:\{[^{}\n]+\}|[A-Za-z0-9+\-=()]+))|(?:\^(?:\{[^{}\n]+\}|[A-Za-z0-9+\-=()]+)))+(?![A-Za-z0-9_])|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttribute(value: string): string { return escapeHtml(value); }
function safeLinkUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  return '#';
}
function richHtml(text: string, depth = 0): string {
  if (depth > 5) return escapeHtml(text);
  const html: string[] = [];
  let remaining = text;
  while (remaining.length) {
    const match = TOKENS.exec(remaining);
    if (!match || match.index === undefined) { html.push(escapeHtml(remaining)); break; }
    if (match.index) html.push(escapeHtml(remaining.slice(0, match.index)));
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      html.push(`<strong>${richHtml(token.slice(2, -2), depth + 1)}</strong>`);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      html.push(`<code>${escapeHtml(token.slice(1, -1))}</code>`);
    } else if (token.startsWith('\\(') && token.endsWith('\\)')) {
      html.push(`\\(${escapeHtml(token.slice(2, -2))}\\)`);
    } else if (token.startsWith('$') && token.endsWith('$')) {
      html.push(`\\(${escapeHtml(token.slice(1, -1))}\\)`);
    } else if (/^[A-Za-z](?:(?:_(?:\{[^{}]+\}|[A-Za-z0-9+\-=()]+))|(?:\^(?:\{[^{}]+\}|[A-Za-z0-9+\-=()]+)))+$/.test(token)) {
      html.push(`\\(${escapeHtml(token)}\\)`);
    } else if (token.startsWith('[')) {
      const linked = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linked) html.push(`<a href="${escapeAttribute(safeLinkUrl(linked[2]))}">${richHtml(linked[1], depth + 1)}</a>`);
      else html.push(escapeHtml(token));
    } else if (token.startsWith('*') && token.endsWith('*')) {
      html.push(`<em>${richHtml(token.slice(1, -1), depth + 1)}</em>`);
    } else html.push(escapeHtml(token));
    remaining = remaining.slice(match.index + token.length);
  }
  return html.join('');
}
function normalizeDisplayLatex(source: string): string {
  let tex = source.trim();
  if (tex.startsWith('\\[') && tex.endsWith('\\]')) tex = tex.slice(2, -2).trim();
  else if (tex.startsWith('$$') && tex.endsWith('$$')) tex = tex.slice(2, -2).trim();
  else if (tex.startsWith('\\(') && tex.endsWith('\\)')) tex = tex.slice(2, -2).trim();
  // Les environnements align/equation sont des formules autonomes dans MathJax.
  // En revanche, aligned, cases, matrix et split doivent rester en mode display.
  const topLevel = /^\\begin\{(?:align\*?|gather\*?|equation\*?|multline\*?|flalign\*?|alignat\*?)\}/.test(tex);
  return topLevel ? escapeHtml(tex) : `\\[${escapeHtml(tex)}\\]`;
}
function typography(variant: OriaMathVariant) {
  if (variant === 'h1') return [25, 33, 700];
  if (variant === 'h2') return [21, 29, 700];
  if (variant === 'h3') return [17, 25, 700];
  return variant === 'quote' ? [14, 23, 400] : [14, 23, 400];
}

function htmlDocument(content: string, mode: MathViewMode, variant: OriaMathVariant, dark: boolean, zoom: number): string {
  const [fontSize, lineHeight, fontWeight] = typography(variant);
  const color = dark ? '#f4f4f5' : '#171717';
  const link = dark ? '#d9d9df' : '#2563eb';
  const isDisplay = mode === 'display';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
:root{color-scheme:${dark ? 'dark' : 'light'}}
*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%;background:transparent;color:${color};-webkit-text-size-adjust:100%;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:${fontSize}px;line-height:${lineHeight}px;font-weight:${fontWeight};overflow-x:hidden;overflow-y:auto;}
#outer{width:100%;overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch;}
#content{${isDisplay ? 'display:table;min-width:100%;width:max-content;white-space:nowrap;text-align:center;padding:10px 12px;' : 'width:100%;overflow-wrap:anywhere;word-break:normal;padding:1px 0;'}font-size:${zoom * 100}%;}
strong{font-weight:700}em{font-style:italic}code{font-family:ui-monospace,Menlo,Consolas,monospace;background:${dark ? '#27272a' : '#f1f1f2'};padding:1px 3px;border-radius:4px}
a{color:${link};text-decoration:underline}mjx-container{color:${color} !important;}
mjx-container:not([display="true"]){display:inline-block !important;vertical-align:middle;margin:0 .04em !important}
mjx-container[display="true"]{display:inline-block !important;margin:0 !important;text-align:center !important}
mjx-container svg{fill:currentColor !important;max-width:none !important;}
</style>
<script>
(function(){
 var sent=false;
 function post(payload){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(payload))}catch(e){}}
 var timer=setTimeout(function(){if(!sent)post({type:'math-error',reason:'timeout'})},12000);
 function size(){var c=document.getElementById('content');if(!c)return;
  var r=c.getBoundingClientRect();var height=Math.ceil(Math.max(r.height,c.scrollHeight,1)+2);
  post({type:'math-size',height:height});
 }
 window.oriaMathError=function(){clearTimeout(timer);post({type:'math-error',reason:'network'})};
 window.MathJax={
  tex:{processEscapes:true,packages:{'[+]':['noerrors','noundefined']},maxMacros:1000},
  svg:{fontCache:'local'},options:{enableMenu:false},
  startup:{pageReady:function(){return MathJax.startup.defaultPageReady().then(function(){
   sent=true;clearTimeout(timer);
   requestAnimationFrame(function(){requestAnimationFrame(size)});
   if(window.ResizeObserver){var ob=new ResizeObserver(size);ob.observe(document.getElementById('content'));}
  }).catch(function(){oriaMathError()})}}
 };
})();
</script>
<script defer src="${MATHJAX_CDN}" onerror="oriaMathError()"></script>
</head><body><div id="outer"><div id="content">${content}</div></div></body></html>`;
}

type CanvasProps = MathTheme & { content: string; variant: OriaMathVariant; mode: MathViewMode; fallback: string; zoom?: number; heightLimit?: number };
function MathCanvas({ content, variant, mode, fallback, isDark, language = 'fr', zoom = 1, heightLimit }: CanvasProps) {
  const display = mode === 'display';
  const maxHeight = heightLimit ?? (display ? Math.min(Dimensions.get('window').height * .67, 720) : 1200);
  const [height, setHeight] = useState(display ? 76 : 28);
  const [failed, setFailed] = useState(false);
  const [rendered, setRendered] = useState(false);
  const html = useMemo(() => htmlDocument(content, mode, variant, isDark, zoom), [content, mode, variant, isDark, zoom]);
  // Stable source identity: never reload the WebView merely because its measured height changed.
  const webSource = useMemo(() => ({ html }), [html]);
  useEffect(() => { setHeight(display ? 76 : 28); setFailed(false); setRendered(false); }, [html, display]);
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const payload: unknown = JSON.parse(event.nativeEvent.data);
      if (!payload || typeof payload !== 'object') return;
      const item = payload as { type?: string; height?: number };
      if (item.type === 'math-error') { setFailed(true); return; }
      if (item.type !== 'math-size' || typeof item.height !== 'number' || !Number.isFinite(item.height)) return;
      setRendered(true);
      const next = Math.max(display ? 52 : 23, Math.min(Math.ceil(item.height), maxHeight));
      setHeight(current => Math.abs(current - next) >= 4 ? next : current);
    } catch { /* ignore */ }
  }, [display, maxHeight]);
  const onNavigate = useCallback((request: { url: string }): boolean => {
    const url = String(request.url || '');
    if (!url || url === 'about:blank' || url.startsWith('data:') || url === MATHJAX_CDN) return true;
    if (/^https:\/\//i.test(url) || /^mailto:/i.test(url)) void Linking.openURL(url).catch(() => undefined);
    return false;
  }, []);
  if (failed) return <View style={{ padding: 8, gap: 6 }}>
    <Text selectable style={{ color: isDark ? '#f4f4f5' : '#1b1b1b', fontSize: 13 }}>{fallback}</Text>
    <Text style={{ color: '#a1a1aa', fontSize: 11 }}>{language === 'fr' ? 'Moteur mathématique indisponible. Vérifiez la connexion.' : 'Math engine unavailable. Check your connection.'}</Text>
  </View>;
  return <View style={{ height, width: '100%', position: 'relative' }}>
    <WebView<unknown>
      source={webSource} originWhitelist={['*']} onMessage={onMessage} onShouldStartLoadWithRequest={onNavigate}
      onError={() => setFailed(true)} javaScriptEnabled domStorageEnabled={false}
      setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
      scrollEnabled showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
      nestedScrollEnabled bounces={false} overScrollMode="never"
      style={{ width: '100%', height, backgroundColor: 'transparent' }}
    />
    {!rendered ? <View pointerEvents="none" style={{ position:'absolute',top:8,right:8 }}>
      <ActivityIndicator size="small" color={isDark ? '#e4e4e7' : '#71717a'}/>
    </View> : null}
  </View>;
}

export function OriaMathInlineText({ text, variant = 'body', isDark, language = 'fr' }: MathTheme & { text: string; variant?: OriaMathVariant }) {
  const content = useMemo(() => text.length > MAX_LATEX_CHARACTERS ? '' : richHtml(text), [text]);
  if (text.length > MAX_LATEX_CHARACTERS) return <Text selectable style={{color:isDark?'#f4f4f5':'#171717'}}>{text}</Text>;
  return <MathCanvas content={content} mode="inline" variant={variant} fallback={text} isDark={isDark} language={language}/>;
}

export default function OriaMathRenderer({ latex, isDark, language = 'fr' }: MathTheme & { latex: string }) {
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const content = useMemo(() => normalizeDisplayLatex(latex), [latex]);
  const label = language === 'fr' ? 'Agrandir la formule' : 'Expand formula';
  if (latex.length > MAX_LATEX_CHARACTERS) return <Text selectable style={{color:isDark?'#f4f4f5':'#171717'}}>{latex}</Text>;
  return <View style={[styles.block,{ borderColor:isDark?'#35353a':'#e9e9ed' }]}>
    <View style={[styles.toolbar,{backgroundColor:isDark?'#222226':'#fafafa'}]}>
      <Text style={[styles.label,{color:isDark?'#a1a1aa':'#71717a'}]}>ORIA · MATH</Text>
      <View style={styles.actions}>
        <Pressable onPress={() => void Clipboard.setStringAsync(latex).catch(() => undefined)} accessibilityRole="button" accessibilityLabel={language === 'fr' ? 'Copier le LaTeX' : 'Copy LaTeX'} hitSlop={8} style={styles.action}>
          <Ionicons name="copy-outline" color={isDark?'#e4e4e7':'#3f3f46'} size={17}/>
        </Pressable>
        <Pressable onPress={() => setExpanded(true)} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={styles.action}>
          <Ionicons name="expand-outline" color={isDark?'#e4e4e7':'#3f3f46'} size={17}/>
        </Pressable>
      </View>
    </View>
    <MathCanvas content={content} mode="display" variant="body" fallback={latex} isDark={isDark} language={language}/>
    <Modal visible={expanded} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setExpanded(false)}>
      <SafeAreaView style={[styles.modal,{backgroundColor:isDark?'#101014':'#fff'}]}>
        <View style={styles.modalBar}>
          <Pressable accessibilityRole="button" accessibilityLabel={language === 'fr'?'Fermer':'Close'} onPress={() => setExpanded(false)} style={styles.action}>
            <Ionicons name="close" size={24} color={isDark?'#fff':'#18181b'}/>
          </Pressable>
          <Text style={{color:isDark?'#fff':'#18181b',fontWeight:'600'}}>{language === 'fr'?'Équation':'Equation'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Copier LaTeX" onPress={() => void Clipboard.setStringAsync(latex).catch(() => undefined)} style={styles.action}>
            <Ionicons name="copy-outline" size={21} color={isDark?'#fff':'#18181b'}/>
          </Pressable>
        </View>
        <View style={{flex:1,justifyContent:'center',paddingHorizontal:12}}>
          <MathCanvas content={content} mode="display" variant="body" fallback={latex} isDark={isDark} language={language} zoom={zoom} heightLimit={Dimensions.get('window').height*.75}/>
        </View>
        <View style={styles.zoomBar}>
          <Pressable onPress={() => setZoom(z => Math.max(.75, Math.round((z-.15)*100)/100))} accessibilityLabel="Zoom moins" style={styles.zoomButton}><Ionicons name="remove" size={23} color={isDark?'#f4f4f5':'#18181b'}/></Pressable>
          <Text style={{color:isDark?'#f4f4f5':'#18181b'}}>{Math.round(zoom*100)} %</Text>
          <Pressable onPress={() => setZoom(z => Math.min(2,Math.round((z+.15)*100)/100))} accessibilityLabel="Zoom plus" style={styles.zoomButton}><Ionicons name="add" size={23} color={isDark?'#f4f4f5':'#18181b'}/></Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
}
const styles=StyleSheet.create({
  block:{width:'100%',marginVertical:8,borderWidth:1,borderRadius:13,overflow:'hidden'},
  toolbar:{minHeight:35,paddingLeft:12,paddingRight:7,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  label:{fontSize:10,fontWeight:'600',letterSpacing:.8},
  actions:{flexDirection:'row',alignItems:'center',gap:6},
  action:{width:33,height:31,justifyContent:'center',alignItems:'center'},
  modal:{flex:1},modalBar:{height:54,paddingHorizontal:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  zoomBar:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:25,paddingVertical:18},
  zoomButton:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#71717a55'},
});
