type Props = {
  className?: string
}

export default function PraxioLogo({ className }: Props) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`h-[22px] w-[22px] shrink-0 ${className ?? ''}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="var(--logo-penrose-warm)"
        fillRule="evenodd"
        d="M41.952,0.043L77.271,69.42L38.01,69.444L30.479,84.299L99.996,84.311L57.587,0L41.952,0.043Z"
      />
      <path
        fill="var(--logo-penrose-cool)"
        fillRule="evenodd"
        d="M41.95,0.038L0,84.297L7.691,99.576L42.493,29.974L61.913,69.443L77.295,69.443L41.95,0.038Z"
      />
      <path
        fill="var(--logo-penrose-tertiary)"
        fillRule="evenodd"
        d="M42.501,29.987L50.17,45.578L30.445,84.31L100,84.35L92.677,100L7.694,99.57L42.501,29.987Z"
      />
    </svg>
  )
}
