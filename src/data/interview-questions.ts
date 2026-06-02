export interface InterviewQuestion {
  id: string
  moduleId: number
  knowledgePointId: string
  difficulty: 'junior' | 'mid' | 'senior'
  category: 'principle' | 'coding' | 'design'
  question: string
  answerPoints: string[]
  relatedCode?: string
}

// 面试题数据按模块追加
export const interviewQuestions: InterviewQuestion[] = []
