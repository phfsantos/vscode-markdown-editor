declare module '*.scss';
declare module '*.css';
declare module '*.png';
declare module '*.jpg';
declare module '*.svg';
declare module '*.txt' {
  const content: string;
  export default content;
}
