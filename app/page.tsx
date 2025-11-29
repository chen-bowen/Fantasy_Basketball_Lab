import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl font-bold text-center mb-4 text-gray-900 dark:text-white">
            Category Edge
          </h1>
          <p className="text-xl text-center mb-12 text-gray-600 dark:text-gray-300">
            AI-Powered Fantasy Basketball Streaming Assistant
          </p>
          
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-semibold mb-6 text-gray-900 dark:text-white">
              Connect Your League
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Connect your Yahoo or ESPN fantasy basketball league to get started with AI-powered streaming recommendations.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/login"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg text-center transition-colors"
              >
                Login / Sign Up
              </Link>
              <Link
                href="/dashboard"
                className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-semibold py-3 px-6 rounded-lg text-center transition-colors"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h3 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
                Auto-Sync Leagues
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                Automatically sync with Yahoo and ESPN leagues. No manual data entry needed.
              </p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h3 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
                AI Recommendations
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                Get personalized streaming recommendations that learn from your decisions.
              </p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h3 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
                Real-Time Updates
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
                See category standings update live during games. Make decisions based on current data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

