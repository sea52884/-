/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  FileUp, 
  Search, 
  AlertCircle, 
  CheckCircle2, 
  ClipboardCheck, 
  Languages, 
  Layout, 
  Type as TypeIcon,
  Loader2,
  ChevronRight,
  Info
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface ReviewResult {
  id: string;
  category: string;
  location: string;
  errorType: string;
  content: string;
  error: string;
  suggestion: string;
}

interface ReviewItem {
  location: string;
  type: string;
  content: string;
  error: string;
  suggestion: string;
  difficulty: string;
  difficultyJustification: string;
  raw: string;
  isEditing?: boolean;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [results, setResults] = useState<string>('');
  const [editedItems, setEditedItems] = useState<ReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('전체');
  const [globalEdit, setGlobalEdit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Timer effect
  React.useEffect(() => {
    if (loading) {
      setElapsedTime(0);
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loading]);

  // Parse Markdown into structured items
  const parseResults = (md: string) => {
    if (!md) return { intro: '', items: [] };

    const firstItemIndex = md.indexOf('**[');
    
    let intro = '';
    let body = '';
    
    if (firstItemIndex === -1) {
      intro = md;
      body = '';
    } else {
      intro = md.substring(0, firstItemIndex);
      body = md.substring(firstItemIndex);
    }

    const items: ReviewItem[] = [];
    const itemStrings = body.split(/\*\*\[(?=[^\]]+\]\*\*)/).filter(s => s.trim().length > 0);

    for (const s of itemStrings) {
      const fullItem = '**[' + s;
      
      const locationMatch = fullItem.match(/\*\*\[(.*?)\]\*\*/);
      const location = locationMatch ? locationMatch[1] : '위치 미상';

      const extractSection = (label: string) => {
        const regex = new RegExp(`- ${label}:\\s*([\\s\\S]*?)(?=\\n- |$)`, 'i');
        const match = fullItem.match(regex);
        return match ? match[1].trim() : '';
      };

      items.push({
        location,
        type: extractSection('오류 유형'),
        content: extractSection('문제 내용'),
        error: extractSection('발견된 오류'),
        suggestion: extractSection('수정 제안'),
        difficulty: extractSection('난이도'),
        difficultyJustification: extractSection('난이도 판정 이유'),
        raw: fullItem,
        isEditing: false
      });
    }

    return { intro: intro.trim(), items };
  };

  const { intro, items: initialItems } = parseResults(results);
  
  // Sync parsed items to state once when results change
  React.useEffect(() => {
    if (initialItems.length > 0) {
      setEditedItems(initialItems);
    } else {
      setEditedItems([]);
    }
  }, [results]);

  const categories = ['전체', ...Array.from(new Set(editedItems.map(item => item.type)))];

  const filteredItems = filter === '전체' 
    ? editedItems 
    : editedItems.filter(item => item.type === filter);

  const toggleEdit = (index: number) => {
    const newItems = [...editedItems];
    newItems[index].isEditing = !newItems[index].isEditing;
    setEditedItems(newItems);
  };

  const updateItem = (index: number, field: keyof ReviewItem, value: string) => {
    const newItems = [...editedItems];
    (newItems[index] as any)[field] = value;
    setEditedItems(newItems);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const analyzeFile = async () => {
    if (!file) return;

    setLoading(true);
    setResults('');
    setError(null);
    setFilter('전체');
    setStatus('파일을 분석 중입니다...');

    try {
      const fileType = file.name.split('.').pop()?.toLowerCase();
      let promptContent: any = null;

      const isMultimodal = ['pdf', 'png', 'jpg', 'jpeg'].includes(fileType || '');

      if (isMultimodal) {
        setStatus(`${fileType?.toUpperCase()} 데이터를 처리 중입니다...`);
        const base64 = await fileToBase64(file);
        let mimeType = '';
        if (fileType === 'pdf') mimeType = 'application/pdf';
        else if (fileType === 'png') mimeType = 'image/png';
        else mimeType = 'image/jpeg';

        promptContent = {
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64.split(',')[1],
                },
              },
              {
                text: `당신은 고등학교 주요 교과목(국어, 영어, 수학, 사회, 과학 등) 시험지를 검토하는 대한민국 최고의 전문 교육 편집자입니다. 
귀하의 임무는 한치의 오차도 없이 시험지의 모든 오류를 찾아내는 것입니다. 
첨부된 파일을 시각적으로 정밀하게 분석(OCR 및 구조 분석)하여 다음 사항을 검토하십시오.

### [필수 수행 단계: 기호 인벤토리]
분석을 시작하기 전에, 먼저 문서에 있는 모든 문항 번호와 각 문항의 선택지 기호(①, ②, ③, ④, ⑤ 등), 그리고 지문 속에 삽입된 알파벳 기호(ⓐ, ⓑ, ⓒ, ⓓ, ⓔ) 또는 숫자 기호(㉠, ㉡, ㉢)를 있는 그대로 순서대로 나열해 보십시오. 이 과정을 통해 중복되거나 누락된 번호/기호를 먼저 스스로 파악하십시오. (이 부분은 최종 보고서 서두에 '기호 점검 내역'으로 짧게 포함시켜 주십시오.)

### [검토 항목]
1. **중복 기호 및 번호 검토 (CRITICAL)**
- **문항 번호 중복**: 같은 번호의 문항이 중복되거나 순서가 어긋났는가?
- **기호 중복**: 지문 속 ⓐ, ⓑ.. 또는 ㉠, ㉡.. 기호가 중복 사용되지 않았는가?
- **선택지 기호 중복**: 한 문항 내에서 같은 기호(예: ③이 두 번)가 반복되는가?

2. **세부 검토 항목**
- **오타 및 철자**: 국어 맞춤법, 영어 스펠링, 전문 용어 표기 오류.
- **내용 오류**: 수학 공식 오류, 과학적 사실 오류, 역사적 연도/인물 오류 등 교과 내용의 무결성.
- **문법/문장**: 문장 구조의 결함, 비문(非文), 번역투 표현 등.
- **문제 논리**: 정답 부재, 복수 정답, 지문과 문제의 불일치.
- **형식/이미지**: 배점 누락, 출처 오기, 밑줄/괄호 위치 오류, 그래프/도표 설명 불일치.

### [출력 형식 (Strict)]
보고서 서두에 **[기호 점검 내역]**을 간략히 작성한 후, **오타, 중복, 문법, 논리 등 '오류가 발견된 문항'에 대해서만** 다음 형식으로 보고하십시오. (오류가 없는 정상적인 문항은 리포트에서 완전히 제외하십시오.)

**[문제 번호 / 위치]**
- 오류 유형: 
- 문제 내용: 
- 발견된 오류: 
- 수정 제안: 
- 난이도: (하, 중, 상 중 하나 선택)
- 난이도 판정 이유: (어휘 수준, 문법 구조, 인지적 요구 사항을 고려하여 간략히 작성)`,
              },
            ],
          }],
        };
      } else {
        // For other files, extract text via server first
        setStatus('파일에서 텍스트를 추출 중입니다...');
        const formData = new FormData();
        formData.append('file', file);

        const extractRes = await fetch('/api/extract-text', {
          method: 'POST',
          body: formData,
        });

        if (!extractRes.ok) {
          const errData = await extractRes.json();
          throw new Error(errData.error || '텍스트 추출에 실패했습니다.');
        }

        const { text } = await extractRes.json();
        
        promptContent = {
          contents: `당신은 고등학교 주요 교과목(국어, 영어, 수학, 사회, 과학 등) 시험지를 검토하는 대한민국 최고의 전문 교육 편집자입니다. 
다음은 시험지에서 추출된 텍스트입니다. 한치의 오차도 없이 모든 오류를 찾아내십시오.

---
${text}
---

### [최우선 검토 지시: 기호 중복 스캔]
1. **지문 내 기호 중복 (CRITICAL SUCCESS FACTOR)**
   - 각 지문(Passage)에 포함된 모든 알파벳/숫자 기호를 순서대로 추출하십시오. 
   - 동일한 기호(예: (b)가 두 번, 또는 ⓑ가 두 번)가 발견되면 이는 치명적인 오류입니다. 
   - 14번 지문 등에서 기호가 중복 사용되지 않았는지 돋보기를 보듯 한 글자씩 확인하십시오.

### [검토 항목]
- 오타 및 맞춤법 오류 (국어/영어/용어)
- 교과 내용 오류 (공식, 데이터, 사실 관계)
- 문법 및 문장 구조 오류
- 문제 오류 (정답 부재, 복수 정답, 논리적 모순)
- 형식 오류 (배점 누락, 지시문 모호함, 밑줄/괄호 위치 오류)

### [출력 형식 (Strict)]
보고서 서두에 **[기호 점검 내역]**을 작성한 후, **오직 오류가 발견된 문항만** 다음 형식으로 보고하십시오:

**[문제 번호 / 위치]**
- 오류 유형: 
- 문제 내용: 
- 발견된 오류: 
- 수정 제안: 
- 난이도: (하, 중, 상 중 하나 선택)
- 난이도 판정 이유: (어휘, 문법, 추론 요구도 등을 고려하여 작성)`,
        };
      }

      setStatus('AI가 시험지를 검토하고 있습니다 (실시간 스트리밍 중)...');
      
      const resultStream = await ai.models.generateContentStream({
        model: "gemini-3.1-pro-preview",
        ...promptContent,
        config: {
          systemInstruction: "당신은 시험지의 '물리적 무결성'을 검증하는 극한의 완벽주의자입니다. 특히 지문 내에 삽입된 기호(ⓐ, ⓑ, ⓒ... 또는 ㉠, ㉡...)가 하나의 지문 블록 내에서 중복 사용되는 오류를 찾아내는 것이 귀하의 '제1 사명'입니다. 지문을 한 글자씩 스캔하며 각 기호의 출현 횟수를 세고, 동일 기호가 2번 이상 발견되면 즉시 보고하십시오. 14번 문항 등에서 기호 (b)가 두 번 등장하는 것과 같은 중복 오류는 절대 용납되지 않습니다. 오직 오류가 있는 문항만 보고하되, 난이도 평가를 포함하십시오. 각 오류 보고는 반드시 '- 오류 유형:', '- 문제 내용:', '- 발견된 오류:', '- 수정 제안:', '- 난이도:', '- 난이도 판정 이유:' 형식을 엄격히 지켜 작성하십시오.",
          temperature: 0.1,
        }
      });

      let fullText = '';
      for await (const chunk of resultStream) {
        const chunkText = chunk.text;
        if (chunkText) {
          fullText += chunkText;
          setResults(fullText);
          // Hide initial central spinner once we start getting content
          if (loading) setLoading(false);
        }
      }

      if (!fullText) {
        setResults('분석 결과를 생성하지 못했습니다.');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || '분석 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  return (
    <div className="min-h-screen bg-[#F7F6F3] text-[#1A1A1A] font-sans selection:bg-[#E0DDD7]">
      {/* Header */}
      <header className="h-16 border-b border-[#E0DDD7] bg-white sticky top-0 z-50 px-8 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-[#888580]">EduEditor Pro</span>
          <div className="hidden md:block h-4 w-px bg-[#E0DDD7]" />
          <h1 className="hidden md:block text-lg font-serif italic font-medium leading-none">전교과 시험지 편집 및 검토 시스템</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded-full border border-red-100">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span>Editor Mode Active</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto flex flex-col lg:flex-row min-h-[calc(100-4rem)]">
        {/* Sidebar: Review Input */}
        <aside className="w-full lg:w-80 lg:border-r border-[#E0DDD7] bg-[#FAF9F7] p-8 space-y-10">
          <section className="space-y-6">
            <div>
              <h2 className="text-[11px] font-bold tracking-widest uppercase text-[#A19E98] mb-4">시험지 업로드</h2>
              <p className="text-xs text-[#888580] leading-relaxed italic">
                PDF, HWPX, DOCX 지원. 전문 교육 편집자의 시각으로 오타, 문법, 문제 논리 및 형식을 검토합니다.
              </p>
            </div>
            
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border border-[#E0DDD7] bg-white rounded-lg p-8 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 group",
                file ? "bg-stone-50 border-stone-400" : "hover:border-[#A19E98] hover:bg-stone-50/50"
              )}
            >
              <input 
                type="file" 
                ref={fileInputRef}
                className="hidden" 
                accept=".pdf,.hwpx,.docx,.txt,.jpg,.jpeg,.png"
                onChange={handleFileUpload} 
              />
              
              {file ? (
                <>
                  <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center border border-[#E0DDD7] group-hover:scale-110 transition-transform">
                    <FileUp className="w-5 h-5 text-stone-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-bold text-stone-900 truncate max-w-[180px]">{file.name}</p>
                    <p className="text-[10px] font-mono text-stone-400 mt-1 uppercase">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 bg-[#F7F6F3] rounded-full flex items-center justify-center border border-dashed border-[#E0DDD7]">
                    <FileUp className="w-5 h-5 text-[#A19E98]" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-stone-600">파일 클릭 또는 드롭</p>
                    <p className="text-[10px] text-stone-400 uppercase mt-1">PDF, HWPX, Image 지원</p>
                  </div>
                </>
              )}
            </div>

            {file && !loading && (
              <button
                onClick={analyzeFile}
                disabled={loading}
                className="w-full bg-[#1A1A1A] hover:bg-black text-white text-xs font-bold py-4 rounded-lg tracking-widest transition-all active:scale-[0.98] flex items-center justify-center gap-2 uppercase"
              >
                <Search className="w-3 h-3" />
                Analyze Document
              </button>
            )}
          </section>

          <section className="pt-8 border-t border-[#E0DDD7]">
            <h2 className="text-[11px] font-bold tracking-widest uppercase text-[#A19E98] mb-6">검토 항목</h2>
            <ul className="space-y-4">
              {[
                { icon: TypeIcon, label: '오타 및 철자 오류', color: 'bg-red-400' },
                { icon: Layout, label: '문법 및 문장 구조', color: 'bg-orange-400' },
                { icon: Languages, label: '문제 및 지문 논리', color: 'bg-blue-400' },
                { icon: AlertCircle, label: '형식 및 배점 검증', color: 'bg-green-400' }
              ].map((item, i) => (
                <li key={i} className="flex items-center justify-between group">
                  <span className="flex items-center gap-3 text-xs text-[#555] group-hover:text-[#1A1A1A] transition-colors">
                    <div className={cn("w-1.5 h-1.5 rounded-full", item.color)} />
                    {item.label}
                  </span>
                  <div className="h-[1px] flex-1 mx-3 bg-[#E0DDD7] opacity-0 group-hover:opacity-100 transition-opacity" />
                  <ChevronRight className="w-3 h-3 text-[#E0DDD7]" />
                </li>
              ))}
            </ul>
          </section>
          
          <div className="pt-8 flex-1">
             <div className="p-5 bg-[#1A1A1A] text-white rounded-lg">
                <p className="text-[10px] font-black opacity-40 mb-2 uppercase tracking-tighter">AI Analysis Engine</p>
                <p className="text-[11px] leading-relaxed font-serif italic text-stone-300">
                  수능 및 모평 기준 데이터를 바탕으로 전교과 시험 문항의 타당성과 오류 유무를 정밀 진단합니다.
                </p>
             </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <section className="flex-1 bg-white p-8 lg:p-12 overflow-hidden flex flex-col min-h-[500px]">
          <AnimatePresence mode="wait">
            {loading && !results ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col items-center justify-center text-center py-20"
              >
                <div className="relative mb-10 scale-125">
                  <div className="w-16 h-16 border border-stone-200 rounded-full animate-pulse flex items-center justify-center">
                    <span className="text-[10px] font-mono text-stone-400">{elapsedTime}s</span>
                  </div>
                  <Loader2 className="w-8 h-8 text-[#1A1A1A] animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <h3 className="text-xl font-serif italic mb-4">{status}</h3>
                <div className="w-48 h-1 bg-stone-100 rounded-full overflow-hidden mx-auto mb-6">
                  <motion.div 
                    initial={{ x: "-100%" }}
                    animate={{ x: "0%" }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                    className="w-full h-full bg-stone-800"
                  />
                </div>
                <p className="text-[10px] text-stone-400 uppercase tracking-[0.2em] leading-loose">
                  문서 복잡도에 따라 최대 60초가 소요될 수 있습니다.
                </p>
              </motion.div>
            ) : error ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-10 border border-red-100 bg-red-50/30 rounded-lg text-red-800"
              >
                <h3 className="text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2 text-red-600">
                  <AlertCircle className="w-4 h-4" /> System Error
                </h3>
                <p className="font-serif italic text-lg leading-relaxed">{error}</p>
                <button 
                  onClick={() => setError(null)}
                  className="mt-6 text-[10px] font-bold uppercase border-b border-red-800 pb-1"
                >
                  Restart Diagnostic
                </button>
              </motion.div>
            ) : results ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-10"
              >
                <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-[#F0EFEA] pb-8 gap-6">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Review Report Feed</p>
                      <button 
                        onClick={() => setGlobalEdit(!globalEdit)}
                        className={cn(
                          "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all",
                          globalEdit 
                            ? "bg-[#1A1A1A] text-white" 
                            : "bg-stone-50 text-stone-400 hover:text-stone-600 border border-stone-200"
                        )}
                      >
                        {globalEdit ? 'Finish Editing' : 'Global Edit Mode'}
                      </button>
                    </div>
                    <h3 className="text-3xl font-serif italic">발견된 주요 오류 리포트</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-tighter text-[#A19E98]">
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setFilter(cat)}
                        className={cn(
                          "px-2 py-1 transition-all border-b-2",
                          filter === cat 
                            ? "text-[#1A1A1A] border-[#1A1A1A]" 
                            : "border-transparent hover:text-[#555]"
                        )}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {intro && (
                  <div className="p-8 bg-stone-50 rounded-xl border border-stone-100">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#A19E98] mb-4">기호 및 번호 점검 내역</h4>
                    <div className="markdown-body prose prose-stone max-w-none text-xs italic opacity-70">
                      <ReactMarkdown>{intro}</ReactMarkdown>
                    </div>
                  </div>
                )}

                <div className="space-y-12">
                  {editedItems.length > 0 ? (
                    filteredItems.length > 0 ? (
                      filteredItems.map((item, idx) => (
                        <div key={idx} className="group border-l-2 border-[#1A1A1A] pl-8 py-2 relative">
                          <div className="absolute -left-1.5 top-2 w-3 h-3 rounded-full bg-[#1A1A1A] border-2 border-white shadow-sm" />
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-bold bg-[#1A1A1A] text-white px-2 py-0.5 tracking-tighter">
                                [{item.location}]
                              </span>
                              <span className={cn(
                                "text-[10px] font-bold uppercase tracking-widest text-[#555]"
                              )}>
                                오류 유형: 
                                <input 
                                  value={item.type}
                                  onChange={(e) => updateItem(idx, 'type', e.target.value)}
                                  className={cn(
                                    "ml-2 font-bold focus:outline-none focus:ring-1 focus:ring-stone-200 px-1 rounded transition-colors",
                                    item.type.includes('중복') ? "text-red-500" : "text-stone-500"
                                  )}
                                />
                              </span>
                              {item.difficulty && (
                                <span className={cn(
                                  "text-[9px] font-black px-2 py-0.5 rounded-sm border inline-flex items-center",
                                  item.difficulty.includes('상') ? "bg-red-50 border-red-200 text-red-700" :
                                  item.difficulty.includes('중') ? "bg-amber-50 border-amber-200 text-amber-700" :
                                  "bg-emerald-50 border-emerald-200 text-emerald-700"
                                )}>
                                  难易度: 
                                  <input 
                                    className="bg-transparent border-none focus:ring-0 ml-1 font-black w-8 text-center" 
                                    value={item.difficulty}
                                    onChange={(e) => updateItem(idx, 'difficulty', e.target.value)}
                                  />
                                </span>
                              )}
                            </div>
                            <button 
                              onClick={() => toggleEdit(idx)}
                              className={cn(
                                "text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-1",
                                item.isEditing ? "text-[#1A1A1A]" : "text-[#A19E98] hover:text-[#1A1A1A]"
                              )}
                            >
                              {item.isEditing ? 'Close Editor' : 'Detail Editor'}
                            </button>
                          </div>
                          
                          <div className="space-y-4">
                            {(item.isEditing || globalEdit) ? (
                              <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                                <div>
                                  <label className="text-[10px] font-bold text-stone-400 uppercase block mb-1">문제 내용</label>
                                  <textarea 
                                    className="w-full bg-[#F7F6F3] border border-[#E0DDD7] rounded p-3 text-sm font-serif italic text-stone-600 focus:outline-none focus:border-stone-400 min-h-[80px]"
                                    value={item.content}
                                    onChange={(e) => updateItem(idx, 'content', e.target.value)}
                                    placeholder="분석된 문항 지문을 입력하십시오..."
                                  />
                                </div>
                                <div className="grid md:grid-cols-2 gap-4">
                                  <div>
                                    <label className="text-[10px] font-bold text-red-400 uppercase block mb-1">발견된 오류</label>
                                    <textarea 
                                      className="w-full bg-red-50/20 border border-red-100/50 rounded p-3 text-xs text-red-900 focus:outline-none focus:border-red-200 min-h-[100px]"
                                      value={item.error}
                                      onChange={(e) => updateItem(idx, 'error', e.target.value)}
                                      placeholder="발견된 오류 내용을 작성하십시오..."
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-green-400 uppercase block mb-1">수정 제안</label>
                                    <textarea 
                                      className="w-full bg-green-50/20 border border-green-100/50 rounded p-3 text-xs text-green-900 font-medium focus:outline-none focus:border-green-200 min-h-[100px]"
                                      value={item.suggestion}
                                      onChange={(e) => updateItem(idx, 'suggestion', e.target.value)}
                                      placeholder="수정 가이드를 작성하십시오..."
                                    />
                                  </div>
                                </div>
                                <div className="grid md:grid-cols-1 gap-4">
                                  <div>
                                    <label className="text-[10px] font-bold text-stone-400 uppercase block mb-1">난이도 판정 이유</label>
                                    <textarea 
                                      className="w-full bg-[#F7F6F3] border border-[#E0DDD7] rounded p-3 text-xs text-stone-600 focus:outline-none focus:border-stone-400 min-h-[60px]"
                                      value={item.difficultyJustification}
                                      onChange={(e) => updateItem(idx, 'difficultyJustification', e.target.value)}
                                      placeholder="난이도 선정 근거를 입력하십시오(어휘, 문법, 인지 구조 등)..."
                                    />
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div 
                                className="space-y-4 cursor-pointer group/content" 
                                onClick={() => toggleEdit(idx)}
                              >
                                {item.content && (
                                  <div className="relative">
                                    <p className="text-[10px] font-bold text-stone-300 uppercase mb-1">문제 내용</p>
                                    <div className="text-sm font-serif italic text-stone-600 leading-relaxed markdown-report group-hover/content:bg-stone-50 rounded transition-colors px-1">
                                      <ReactMarkdown>{item.content}</ReactMarkdown>
                                    </div>
                                  </div>
                                )}
                                
                                <div className="grid md:grid-cols-2 gap-6 pt-2">
                                  <div className="bg-red-50/40 p-4 rounded-lg border border-red-100/50 group-hover/content:bg-red-50 transition-colors">
                                    <p className="text-[10px] font-bold text-red-800 uppercase mb-2 tracking-tighter">발견된 오류</p>
                                    <div className="text-xs leading-relaxed text-red-900 whitespace-pre-wrap markdown-report">
                                      <ReactMarkdown>{item.error || '내역 없음'}</ReactMarkdown>
                                    </div>
                                  </div>
                                  <div className="bg-green-50/40 p-4 rounded-lg border border-green-100/50 group-hover/content:bg-green-50 transition-colors">
                                    <p className="text-[10px] font-bold text-green-800 uppercase mb-2 tracking-tighter">수정 제안</p>
                                    <div className="text-xs leading-relaxed text-green-900 font-medium whitespace-pre-wrap markdown-report">
                                      <ReactMarkdown>{item.suggestion || '내역 없음'}</ReactMarkdown>
                                    </div>
                                  </div>
                                </div>
                                
                                {item.difficultyJustification && (
                                  <div className="bg-stone-50/50 p-4 rounded-lg border border-stone-100 group-hover/content:bg-stone-50 transition-colors">
                                     <p className="text-[10px] font-bold text-stone-500 uppercase mb-2 tracking-tighter">난이도 판정 근거</p>
                                     <div className="text-[11px] leading-relaxed text-stone-600 italic markdown-report">
                                        <ReactMarkdown>{item.difficultyJustification}</ReactMarkdown>
                                     </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-20 text-center border border-dashed border-stone-200 rounded-xl">
                        <p className="text-sm font-serif italic text-stone-400">해당 유형의 오류가 필터링되었습니다.</p>
                      </div>
                    )
                  ) : (
                    <div className="bg-white rounded-2xl p-8 border border-stone-100 shadow-sm">
                      <div className="flex items-center gap-2 mb-6 text-stone-400">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Raw Response View (Parser Fallback)</span>
                      </div>
                      <div className="markdown-body prose prose-stone max-w-none prose-p:text-sm prose-li:text-sm">
                        <ReactMarkdown>{results}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-12 border-t border-[#F0EFEA] flex justify-between items-center text-[11px] font-bold uppercase tracking-widest text-stone-400">
                  <span>End of Report</span>
                  <div className="flex gap-1">
                    <div className="w-8 h-0.5 bg-[#1A1A1A]" />
                    <div className="w-8 h-0.5 bg-[#E0DDD7]" />
                    <div className="w-8 h-0.5 bg-[#E0DDD7]" />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 flex flex-col items-center justify-center text-center py-20 border border-dashed border-[#E0DDD7] rounded-3xl m-4"
              >
                <div className="mb-8 opacity-20 relative">
                    <div className="absolute inset-0 bg-stone-100 rounded-full scale-150 blur-2xl" />
                    <ClipboardCheck className="w-16 h-16 text-stone-600 relative z-10" />
                </div>
                <h3 className="text-2xl font-serif italic text-stone-300 mb-2">Review Draft Idle</h3>
                <p className="text-[10px] text-stone-400 font-bold uppercase tracking-[0.3em]">
                  Please upload a paper for analysis
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      <footer className="max-w-7xl mx-auto px-8 py-10 border-t border-[#E0DDD7] flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-6">
           <span className="text-[10px] font-bold uppercase tracking-widest text-[#888580]">Tech Specs</span>
           <div className="flex gap-4">
              <span className="text-[10px] text-stone-400">GEMINI 3.1 PRO</span>
              <span className="text-[10px] text-stone-400">REVISION ENGINE V4.0</span>
           </div>
        </div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#888580]">
           © 2026 EduProof Multi-Subject • Professional Content Verification
        </div>
      </footer>
    </div>
  );
}
