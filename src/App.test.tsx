import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the debug overlay', () => {
    render(<App />)
    expect(screen.getByText(/Selection:/)).toBeInTheDocument()
  })
})
